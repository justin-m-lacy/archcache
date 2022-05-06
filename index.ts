
import Emitter from 'eventemitter3';
import Item from './src/item';

export type Loader = (key: string) => Promise<any>;
export type Saver = (key: string, data: any) => Promise<any>;
export type Deleter = (key: string) => Promise<boolean>;
export type Checker = (key: string) => Promise<boolean>;
export type Reviver = (data: any) => any;


export type CacheOpts = {

	cacheKey: string,
	/**
	 * function to load items not found in cache from a data
	 * key is the key of the item not found.
	 */
	loader?: Loader;
	/**
	 * function to store data at key.
	 */
	saver?: Saver;
	reviver?: Reviver;
	/**
	 * function to call when item is being deleted from cache.
	 */
	deleter?: Deleter;

	/**
	 * function that checks the existence of item
	 * in an underlying data store.
	 */
	checker?: Checker
}


/**
 * Setting option properties on parent Cache will not propagate changes
 * to subcaches. Use settings() function.
 */
export default class Cache extends Emitter {

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
	set reviver(v) { this._reviver = v; }

	get deleter() { return this._deleter; }
	set deleter(v) { this._deleter = v; }

	private _dict: { [key: string]: Item | Cache } = {};
	get data() { return this._dict; }

	lastAccess: number = 0;
	_cacheKey: string;

	/**
	 * function to load items not found in cache from a data
	 * key is the key of the item not found.
	 */
	_loader?: Loader;

	/**
	 * function to store data at key.
	 */
	_saver?: Saver;
	_reviver?: Reviver;
	/**
	 * function to call when item is being deleted from cache.
	 */
	_deleter?: Deleter;

	/**
	 * function that checks the existence of item
	 * in an underlying data store.
	 */
	_checker?: (key: string) => Promise<boolean>

	constructor(opts?: CacheOpts) {

		super();

		if (opts) {

			this._cacheKey = opts.cacheKey;

			this._loader = opts.loader;
			this._saver = opts.saver;
			this._checker = opts.checker;
			this._deleter = opts.deleter;
			this._reviver = opts.reviver;

		} else {

			this._cacheKey = '/';

		}

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
	settings(opts: CacheOpts, propagate: boolean = true) {

		if (opts.hasOwnProperty('loader')) this._loader = opts.loader;
		if (opts.hasOwnProperty('saver')) this._saver = opts.saver;
		if (opts.hasOwnProperty('checker')) this._checker = opts.checker;
		if (opts.hasOwnProperty('deleter')) this._deleter = opts.deleter;
		if (opts.hasOwnProperty('reviver')) this._reviver = opts.reviver;

		var newKey = opts.hasOwnProperty('cacheKey');
		this.cacheKey = newKey ? opts.cacheKey : this._cacheKey;

		if (propagate) {

			let dict = this._dict;
			var baseKey = this.cacheKey;

			for (let k in dict) {

				var item = dict[k];

				if (item instanceof Cache) {
					if (newKey) opts.cacheKey = this._subkey(baseKey, k);
					item.settings(opts);
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
	subcache(subkey: string, reviver?: Reviver) {

		subkey = this._subkey(this._cacheKey, subkey);

		let cache = this._dict[subkey];
		if (cache !== undefined && cache instanceof Cache) return cache;

		this._dict[subkey] = cache = new Cache({

			loader: this.loader,
			saver: this.saver,
			checker: this._checker,
			deleter: this.deleter,
			cacheKey: subkey,
			reviver: reviver
		});

		this.emit('subcreate', this, subkey);

		return cache;
	}

	/**
	 * Attempts to find keyed value in the local cache.
	 * If none is found, the value is loaded from the backing store.
	 * @async
	 * @param {string} key
	 * @returns {Promise<*>} - returns undefined if the value is not found.
	 */
	async fetch(key: string) {

		let item = this._dict[key];
		if (item) {
			item.lastAccess = Date.now();
			return item.data;
		}

		if (!this.loader) return undefined;

		//console.log( 'fetching from file: ' + key );
		try {

			let reviver = this.reviver;
			let val = await this.loader(this._cacheKey + key);
			if (val !== undefined) {

				if (reviver) val = reviver(val);
				this._dict[key] = new Item(key, val, false);

			}
			return val;

		} catch (e) {

			this.emit('error', 'fetch', key);

		}

	}

	/**
	 * Caches and attempts to store value to backing store.
	 * @async
	 * @param {string} key
	 * @param {*} value - value to store.
	 * @returns {Promise}
	 */
	async store(key: string, value: any) {

		let item = this._dict[key] = new Item(key, value);

		item.markSaved();

		if (this.saver) {

			return this.saver(this._cacheKey + key, value).then(


				// todo: returns null on success and an error on reject.
				// maybe bad practice?
				null, err => {
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
	get(key: string): any {

		let it = this._dict[key];
		if (it !== undefined) {
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
	cache(key: string, value: any) {

		let cur = this._dict[key];
		if (cur instanceof Item) cur.update(value);
		else this._dict[key] = new Item(key, value);

	}

	/**
	 * Deletes object from local cache and from the backing store.
	 * @async
	 * @param {string} key
	 * @returns {Promise}
	 */
	async delete(key: string) {

		delete this._dict[key];

		if (this.deleter != null) {

			return this.deleter(this._cacheKey + key).then(
				null,
				err => err
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
	async backup(time: number = 1000 * 60 * 2): Promise<any[] | undefined> {

		let saver = this.saver;
		if (!saver) return;

		let now = Date.now();
		let dict = this._dict;

		let saves = [];

		for (let k in dict) {

			var item = dict[k];
			if (item instanceof Cache) {

				//subcache.
				saves.push(item.backup(time));

			} else if (item.dirty && (now - item.lastSave) > time) {

				saves.push(saver(this._cacheKey + item.key, item.data).then(
					null, err => err
				))

			}

		} // for

		return Promise.all(saves).then(
			vals => {
				this.emit('backup', this, vals);
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
	async cleanup(time: number = 1000 * 60 * 5): Promise<any[] | void> {

		let saver = this.saver;
		if (!saver) return this._cleanNoSave(time);

		let now = Date.now();
		let dict = this._dict;

		let saves = [];

		for (let k in dict) {

			var item = dict[k];
			if (item instanceof Cache) {

				saves.push(item.cleanup(time));

			} else if (now - item.lastAccess > time) {

				// done first to prevent race conditions on save.
				delete dict[k];

				if (item.dirty) {

					saves.push(
						saver(this._cacheKey + item.key, item.data).then(null, err => err)
					);

				}

			}

		} // for

		return Promise.all(saves).then(vals => {
			this.emit('cleanup', this, vals); return vals
		});

	}

	/**
	 * Clean old items from cache without storing to backing store.
	 * @param {number} time - Minimum time in ms since last access.
	 */
	_cleanNoSave(time: number) {

		let now = Date.now();
		let dict = this._dict;

		for (let k in dict) {

			var item = dict[k];
			if (item instanceof Cache) {

				item._cleanNoSave(time);

			} else if (now - item.lastAccess > time) {
				delete dict[k];
			}

		} // for

	}

	/**
	 * Remove an item from cache, without deleting it from the data store.
	 * @param {string} key
	 */
	free(key: string) { delete this._dict[key]; }


	/**
	 * Checks if the keyed data exists in cache or data store.
	 * @async
	 * @param {string} key
	 * @returns {Promise<boolean>}
	 */
	async exists(key: string) {

		if (this._dict.hasOwnProperty(key)) return true;

		if (this._checker) return this._checker(this._cacheKey + key);

		return false;

	}

	/**
	 * Checks if a data item is locally cached
	 * for the key. Does not check backing store.
	 * @param {string} key
	 * @returns {boolean}
	 */
	has(key: string) {
		return this._dict.hasOwnProperty(key);
	}

	/**
	 * Convert a cache key into valid cacheKey format.
	 * @param {string} key
	 * @returns {string}
	 */
	_fixKey(key: string) {
		if (typeof key !== 'string') return '/';
		if (key.length === 0 || key.charAt(key.length - 1) !== '/') return key + '/';
		return key;
	}

	/**
	 * Create a key for a subcache.
	 * @param {string} parentKey
	 * @param {string} key
	 * @returns {string} key created.
	 */
	_subkey(parentKey: string = '/', key: string = '') {
		return parentKey + this._fixKey(key);
	}

}