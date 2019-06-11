const Item = require( './src/item.js' );
const Emitter = require( 'eventemitter3' );

/**
 * Setting option properties directly will not propagate changes
 * to subcaches. Use settings() function.
 */
module.exports = class Cache extends Emitter {

	/**
	 * @property {string}
	 */
	get cacheKey() { return this._cacheKey; }
	set cacheKey(v) {
		this._cacheKey = this._fixKey(v);
	}

	/**
	 * @property {string=>Promise<*> }
	 */
	get loader() { return this._loader; }
	set loader(v) { this._loader = v; }

	/**
	 * @property {(string,*)=>Promise<*>}
	 */
	get saver() { return this._saver; }
	set saver(v) { this._saver = v; }

	/**
	 * @property {*=>*}
	 */
	get reviver() { return this._reviver; }
	set reviver(v) { this._reviver =v;}

	get deleter() { return this._deleter; }
	set deleter(v) { this._deleter =v;}

	/**
	 * @constructor
	 * @param {?Object} [opts=null] - initialization options.
	 * @param {string} [opts.cacheKey=''] 
	 * @param { string=>Promise<*> } [opts.loader=undefined] - function to load items not found in cache from a data store.
	 * @param { (string,*)=>Promise<*> } [opts.saver=undefined] - function to store a keyed item in the data store.
	 * @param { string=>Promise<boolean> } [opts.deleter=undefined] - function to delete cached item from a data store.
	 * @param { string=>Promise<boolean> } [opts.checker=undefined] - function to check the existence of an item in the data store.
	 * @param { *=>* } [opts.reviver=undefined] optional function to revive objects loaded from data store.
	 */
	constructor( opts=null ) {

		super();

		if ( opts ) {

			this.cacheKey = opts.cacheKey;

			this.loader = opts.loader;
			this.saver = opts.saver;
			this.checker = opts.checker;
			this.deleter = opts.deleter;
			this.reviver = opts.reviver;

		} else {
	
			this._cacheKey = '/';

		}

		this._dict = {};

	}

	/**
	 * 
	 * @param {Object} opts - options being set.
	 * @param { string=>Promise<*>} opts.loader - function to load items not found in cache from a data store.
	 * @param { (string,*)=>Promise } opts.saver - function to store a keyed item in the data store.
	 * @param { string => Promise<boolean> } opts.checker - function to check the existence of a keyed item in the data store.
	 * @param { string=>Promise<boolean> } opts.deleter - function to delete cached items in a data store.
	 * @param {string} [opts.cacheKey=''] 
	 * @param {boolean} [propagate=true] - whether the settings should be propagated
	 * to child caches.
	 */
	settings( opts, propagate=true ) {

		if ( !opts ) return;

		if ( opts.hasOwnProperty('loader') ) this._loader = opts.loader;
		if ( opts.hasOwnProperty('saver') ) this._saver = opts.saver;
		if ( opts.hasOwnProperty('checker') ) this._checker = opts.checker;
		if ( opts.hasOwnProperty('deleter') ) this._deleter = opts.deleter;
		if ( opts.hasOwnProperty('reviver') ) this._reviver = opts.reviver;

		var newKey = opts.hasOwnProperty( 'cacheKey');
		this.cacheKey = newKey ? opts.cacheKey : this._cacheKey;

		if ( propagate ) {

			let dict = this._dict;
			var baseKey = this.cacheKey;

			for( let k in dict ) {

				var item = dict[k];

				if ( item instanceof Cache ) {
					if ( newKey ) opts.cacheKey = this._subkey( baseKey, k );
					item.settings( opts );
				}

			}

		}

	}

	/**
	 * Retrieves or creates a subcache with the given key.
	 * @param {string} subkey - key of the subcache. Final key is prefixed with
	 * the key of the parent cache.
	 * @param {?function} [reviver=null]
	 * @returns {Cache}
	 */
	subcache( subkey, reviver=null ) {

		subkey = this._subkey( this._cacheKey, subkey );

		let cache = this._dict[subkey];
		if ( cache !== undefined && cache instanceof Cache ) return cache;

		this._dict[subkey] = cache = new Cache({

				loader:this.loader, saver:this.saver, checker:this.checker, deleter:this.deleter,
				cacheKey:subkey,
				reviver:reviver
		});

		this.emit( 'subcreate', this, subkey );

		return cache;
	}

	/**
	 * Attempts to find keyed value in the local cache.
	 * If none is found, the value is loaded from the backing store.
	 * @async
	 * @param {string} key
	 * @returns {Promise<*>} - returns undefined if the value is not found.
	 */
	async fetch( key ) {

		let item = this._dict[key];
		if ( item ) {
			item.lastAccess = Date.now();
			return item.data;
		}

		let loader = this.loader;
		let reviver = this.reviver;
		if ( !loader ) return undefined;

		//console.log( 'fetching from file: ' + key );
		try {
			let val = await loader( this._cacheKey + key );
			if ( val ) {

				if ( reviver ) val = this.reviver(val);
				this._dict[key] = new Item(key, val, false );

			}
			return val;
		} catch ( e ) {

			this.emit( 'error', 'fetch', key );
			return undefined;
		}

	}

	/**
	 * Caches and attempts to store value to backing store.
	 * @async
	 * @param {string} key 
	 * @param {*} value - value to store.
	 * @returns {Promise}
	 */
	async store( key, value ) {

		let item = this._dict[key] = new Item(key, value);

		item.markSaved();

		let saver = this.saver;
		if ( saver ) {

			return saver( this._cacheKey + key, value ).then(

				null, err=>{
					return err;
				}
			);

		}

	}

	/**
	 * Attempts to retrieve a value from the cache without checking the backing store.
	 * @param {string} key
	 * @returns {*} - Undefined if key invalid.
	 */
	get( key ) {

		let it = this._dict[key];
		if ( it !== undefined ) {
			it.lastAccess = Date.now();
			return it.data;
		}
		return undefined;

	}

	/**
	 * Cache a value without saving to backing store.
	 * Useful when doing interval backups.
	 * @param {string} key 
	 * @param {*} value - value to cache.
	 */
	cache( key, value ) {

		let cur = this._dict[key];
		if ( cur instanceof Item ) cur.update( value );
		else this._dict[key] = new Item( key, value);

	}

	/**
	 * Deletes object from local cache and from the backing store.
	 * @async
	 * @param {string} key
	 * @returns {Promise}
	 */
	async delete( key ) {

		delete this._dict[key];

		if ( this.deleter != null ) {

			return this.deleter( this._cacheKey + key ).then(
				null,
				err=>err
			);

		}
	
	}

	/**
	 * Backup any items that have not been saved within the given timespan.
	 * @async
	 * @emits 'backup'
	 * @param {number} [time=120000] - Time in ms since last save.
	 * @returns {Promise}
	 */
	async backup( time=1000*60*2 ) {

		let saver = this.saver;
		if ( !saver ) return;

		let now = Date.now();
		let dict = this._dict;

		let saves = [];

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof Cache ) {

				//subcache.
				saves.push( item.backup( time ) );

			} else if ( item.dirty && (now - item.lastSave) > time ) {

				saves.push( saver( this._cacheKey + item.key, item.data ).then(
					null, err=>err
				) )

			}

		} // for

		Promise.all( saves ).then(
			vals=>{
				this.emit( 'backup', this, vals );
				return vals;
			}
		);

	}

	/**
	 * Clear items from cache that have not been accessed recently.
	 * Dirty entries are first saved to file.
	 * @async
	 * @param {number} [time=300000] - Time in ms since last access.
	 * Items not accessed in this time are purged.
	 */
	async cleanup( time=1000*60*5 ) {

		let saver = this.saver;
		if ( !saver ) return this._cleanNoSave(time);

		let now = Date.now();
		let dict = this._dict;

		let saves = [];

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof Cache ) {

				saves.push( item.cleanup( time ) );

			} else if ( now - item.lastAccess > time ) {

				// done first to prevent race conditions on save.
				delete dict[k];

				if ( item.dirty ) {

					saves.push(
						saver( this._cacheKey + item.key, item.data ).then( null, err=>err )
					);

				}

			}

		} // for

		return Promise.all( saves ).then( vals=>{
			this.emit( 'cleanup', this, vals ); return vals
		});

	}

	/**
	 * Clean old items from cache without storing to backing store.
	 * @param {number} time - Minimum time in ms since last access.
	 */
	_cleanNoSave( time ) {

		let now = Date.now();
		let dict = this._dict;

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof Cache ) {

				item._cleanNoSave( time );

			} else if ( now - item.lastAccess > time ) {
				delete dict[k];
			}

		} // for

	}

	/**
	 * Removes an item from cache, without deleting it from the data store.
	 * @param {string} key 
	 */
	free( key ) { delete this._dict[key]; }


	/**
	 * Checks if the keyed data exists in the cache or data store.
	 * @async
	 * @param {string} key
	 * @returns {boolean}
	 */
	async exists( key ) {

		if ( this._dict.hasOwnProperty(key)) return true;

		if ( this.checker ) return await this.checker( this._cacheKey + key);

		return false;

	}

	/**
	 * Checks if a data item is locally cached
	 * for the key. Does not check backing store.
	 * @param {string} key
	 * @returns {boolean}
	 */
	has( key ) {
		return this._dict.hasOwnProperty(key);
	}

	/**
	 * Convert a cache key into valid cacheKey format.
	 * @param {string} key
	 * @returns {string}
	 */
	_fixKey( key ) {
		if ( typeof key !== 'string') return '/';
		if ( key.length === 0 || key.charAt( key.length-1 ) !== '/' ) return key + '/';
		return key;
	}

	/**
	 * Create a key for a subcache.
	 * @param {string} parentKey 
	 * @param {string} key
	 * @returns {string} key created.
	 */
	_subkey( parentKey='/', key='' ) {
		return parentKey + this._fixKey(key);
	}

}