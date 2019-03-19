import Item from 'src/item';

export default class {

	/**
	 * {string}
	 */
	get cacheKey() { return this._cacheKey; }

	/**
	 * @constructor
	 * @param { string=>Promise<*>} loader - function to load items not found in cache from a data store.
	 * @param { (string,*)=>Promise } saver - function to store a keyed item in the data store.
	 * @param { string => Promise<boolean> } checker - function to check the existence of a keyed item in the data store.
	 * @param { string=>Promise<boolean> } deleter - function to delete cached items in a data store.
	 * @param {string} [cacheKey=''] 
	 * @param { *=>* } [reviver=null] optional function to revive objects loaded from data store.
	 */
	constructor( loader, saver, checker, deleter, cacheKey = '', reviver=null) {

		this._cacheKey = cacheKey;

		this.loader = loader;
		this.saver = saver;
		this.checker = checker;
		this.deleter = deleter;
		this.reviver = reviver;

		this._dict = {};

	}

	/**
	 * Creates a subcache of this cache and stores it in the dictionary.
	 * @param {string} subkey - key used to distinguish subcache items.
	 * @parem {function|null} [reviver=null]
	 * @returns {Cache}
	 */
	makeSubCache( subkey, reviver=null ) {

		if ( subkey.charAt( subkey.length-1 ) !== '/' ) subkey += '/';

		let cache = new exports.Cache(
			this.loader, this.saver, this.checker, this.deleter, this._cacheKey + '/' + subkey, reviver );

		//console.log('subcache key: ' + this._cacheKey + '/' + subkey );

		this._dict[subkey] = cache;
		return cache;
	}

	/**
	 * Asynchronous operation. Attempts to find value in local cache,
	 * then tries to load from backing store if not found.
	 * @async
	 * @param {string} key
	 * @returns {Promise<*>}
	 */
	async fetch( key ) {

		let item = this._dict[key];
		if ( item ) {
			item.lastAccess = Date.now();
			return item.data;
		}

		if ( !this.loader ) return null;

		//console.log( 'fetching from file: ' + key );
		let val = await this.loader( this._cacheKey + key );
		if ( val ) {

			if ( this.reviver ) val = this.reviver(val);
			this._dict[key] = new Item(key, val, false );

		}
		return val;

	}

	/**
	 * Caches and attempts to store value to backing store.
	 * @async
	 * @param {string} key 
	 * @param {*} value - value to store.
	 */
	async store( key, value ) {

		let item = new Item(key, value);
		this._dict[key] = item;

		item.markSaved();

		if ( this.saver ) {
			await this.saver( this._cacheKey + key, value );
		}

	}

	/**
	 * Attempts to retrieve a value from the cache
	 * without checking backing store.
	 * @param {string} key
	 * @returns {*} 
	 */
	get( key ) {

		let it = this._dict[key];
		if ( it ) {
			it.lastAccess = Date.now();
			return it.data;
		}
		return null;

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
	 */
	async delete( key ) {

		delete this._dict[key];

		if ( this.deleter != null ) {

			try {
				 await this.deleter( this._cacheKey + key );

			} catch(e) {console.log(e);}

		}
	
	}

	/**
	 * backup any items that have not been saved
	 * for at least the given time span.
	 * @async
	 * @param {number} time - time in ms since last save.
	 */
	async backup( time=1000*60*2 ) {

		if ( !this.saver ) return;

		let now = Date.now();
		let dict = this._dict;

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof exports.Cache ) {

				//subcache.
				item.backup( time );

			} else {

				try {
					if ( item.dirty && (now - item.lastSave) > time ) {

						item.markSaved( now );

						//console.log( 'BACKING UP: ' + item.key );
						await this.saver( this._cacheKey + item.key, item.data );
					}
				} catch ( e ) { console.log(e);}

			}

		} // for

	}

	/**
	 * Clear items from cache that have not been accessed recently.
	 * Dirty entries are first saved to file.
	 * @async
	 * @param {number} time - Time in ms since last access,
	 * for a cached file to be purged.
	 */
	async cleanup( time=1000*60*5 ) {

		if ( !this.saver ) return this._cleanNoSave(time);

		let now = Date.now();
		let dict = this._dict;

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof exports.Cache ) {

				item.cleanup( time );

			} else if ( now - item.lastAccess > time ) {

				// done first to prevent race conditions after save.
				delete dict[k];

				if ( item.dirty ) {

					try {						
						await this.saver( this._cacheKey + item.key, item.data );
					} catch ( e ) { console.log(e);}

				}

			}

		} // for

	}

	/**
	 * Clean old items from cache without storing to backing store.
	 * @param {number} time 
	 */
	_cleanNoSave( time ) {

		let now = Date.now();
		let dict = this._dict;

		for( let k in dict ) {

			var item = dict[k];
			if ( item instanceof exports.Cache ) {

				item._cleanNoSave( time );

			} else if ( now - item.lastAccess > time ) {
				delete dict[k];
			}

		} // for

	}

	/**
	 * Frees the local memory cache, but does not delete from backing store.
	 * @param {string} key 
	 */
	free( key ) { delete this._dict[key]; }


	/**
	 * Checks if the keyed data exists in the cache
	 * or in the underlying backing store.
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


}