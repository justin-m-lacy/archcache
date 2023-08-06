
import Emitter from 'eventemitter3';
import Item from './src/item';

export type Loader<Data=any> = (key: string) => Promise<Data>;
export type Saver = (key: string, data: any) => Promise<any>;
export type Deleter = (key: string) => Promise<boolean>;
export type Checker = (key: string) => Promise<boolean>;
export type Reviver<T> = (data: any) => T;


export type CacheOpts<T> = {

	cacheKey?: string,
	/**
	 * function to load items not found in cache from a data
	 * key is the key of the item not found.
	 */
	loader?: Loader<any>;
	/**
	 * function to store data at key.
	 */
	saver?: Saver;
	reviver?: Reviver<T>;
	/**
	 * function to call when item is being deleted from cache.
	 */
	deleter?: Deleter;

	/**
	 * function that checks the existence of item
	 * in an underlying data store.
	 */
	checker?: Checker,

	/**
	 * Separator between cache keys of subcaches. Defaults to '/'
	 * subcache keys are joined with the seperator and prepended
	 * to the keys of items entered in the cache.
	 */
	subcacheSeparator?:string
}


/**
 * Setting option properties on parent Cache will not propagate changes
 * to subcaches. Use settings() function.
 */
export default class Cache<T=any> extends Emitter {

	get cacheKey() { return this._cacheKey; }
	set cacheKey(v) {
		this._cacheKey = this._fixKey(v);
	}

	get loader() { return this._loader; }
	set loader(v) { this._loader = v; }

	get saver() { return this._saver; }
	set saver(v) { this._saver = v; }

	get reviver() { return this._reviver; }
	set reviver(v) { this._reviver = v; }

	get deleter() { return this._deleter; }
	set deleter(v) { this._deleter = v; }

	private _dict: Map<string, Item<T>|Cache<T>> = new Map();
	get data() { return this._dict; }

	lastAccess: number = 0;
	_cacheKey: string;

	_separator:string = '/';

	/**
	 * function to load items not found in cache from a data
	 * key is the key of the item not found.
	 */
	_loader?: Loader<any>;

	/**
	 * function to store data at key.
	 */
	_saver?: Saver;
	_reviver?: Reviver<T>;
	/**
	 * function to call when item is being deleted from cache.
	 */
	_deleter?: Deleter;

	/**
	 * function that checks the existence of item
	 * in an underlying data store.
	 */
	_checker?: (key: string) => Promise<boolean>

	constructor(opts?: CacheOpts<T>) {

		super();

		if (opts) {

			this._loader = opts.loader;
			this._saver = opts.saver;
			this._checker = opts.checker;
			this._deleter = opts.deleter;
			this._reviver = opts.reviver;

		}

		this._separator = opts?.subcacheSeparator ?? '/';
		this._cacheKey = opts?.cacheKey ?? this._separator;

	}

	/**
	 *
	 * @param opts - options being set.
	 * @param  opts.loader - function to load items not found in cache from a data store.
	 * @param  opts.saver - function to store a keyed item in the data store.
	 * @param  opts.checker - function to check the existence of a keyed item in the data store.
	 * @param  opts.deleter - function to delete cached items in a data store.
	 * @param [opts.cacheKey='']
	 * @param [propagate=true] - whether the settings should be propagated
	 * to child caches.
	 */
	settings(opts: CacheOpts<T>, propagate: boolean = true) {

		if (opts.hasOwnProperty('loader')) this._loader = opts.loader;
		if (opts.hasOwnProperty('saver')) this._saver = opts.saver;
		if (opts.hasOwnProperty('checker')) this._checker = opts.checker;
		if (opts.hasOwnProperty('deleter')) this._deleter = opts.deleter;
		if (opts.hasOwnProperty('reviver')) this._reviver = opts.reviver;

		const keyChanged = opts.cacheKey !== this._cacheKey;
		this.cacheKey = opts.cacheKey ?? this._cacheKey;

		if (propagate) {

			const dict = this._dict;
			const baseKey = this.cacheKey;

			for (const k in dict) {

				const item = dict.get(k);
				if (item instanceof Cache) {

					const subkey = keyChanged ? this._subkey(baseKey, k) : undefined;
					item.settings({

						...opts,
						cacheKey:subkey

					});

				}

			}

		}

	}

	/**
	 * Retrieves or creates a subcache with the given key.
	 * @param subkey - key of the subcache. Final key is prefixed with
	 * the key of the parent cache.
	 * @param  [reviver=null]
	 */
	subcache<S extends T>(subkey: string, reviver?: Reviver<S>):Cache<S> {

		subkey = this._subkey(this._cacheKey, subkey);

		let cache = this._dict.get(subkey) as Cache<S>;
		if (cache !== undefined && cache instanceof Cache) return cache;

		this._dict.set(subkey, cache = new Cache<S>({
			loader: this.loader,
			saver: this.saver,
			checker: this._checker,
			deleter: this.deleter,
			cacheKey: subkey,
			reviver: reviver
		}));

		this.emit('subcreate', this, subkey);

		return cache as Cache<S>;
	}

	/**
	 * Attempts to find keyed value in the local cache.
	 * If none is found, the value is loaded from the backing store.
	 * @async
	 * @param key
	 * @returns - returns undefined if the value is not found.
	 */
	async fetch(key: string) {

		const item = this._dict.get(key);
		if (item) {
			item.lastAccess = Date.now();
			return item.data;
		}

		if (!this.loader) return undefined;

		//console.log( 'fetching from file: ' + key );
		try {

			const reviver = this.reviver;
			const data = await this.loader(this._cacheKey + key);
			if ( data === undefined ) return undefined;
		
				const value = reviver ? reviver(data) : data;
				this._dict.set(key, new Item<T>(key, value, false) );

			return value;

		} catch (e) {

			this.emit('error', 'fetch', key);

		}

	}

	/**
	 * Caches and attempts to store value to backing store.
	 * @async
	 * @param key
	 * @param value - value to store.
	 * @returns {Promise}
	 */
	async store(key: string, value: T) {

		const item = new Item(key, value);
		this._dict.set(key, item );

		item.markSaved();

		if (this.saver) {

			return this.saver(this._cacheKey + key, value).then(

				// returns null on success and an error on reject.
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

		const it = this._dict.get(key);
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

		const cur = this._dict.get(key);
		if (cur instanceof Item) cur.update(value);
		else this._dict.set(key, new Item(key, value));

	}

	/**
	 * Deletes object from local cache and from the backing store.
	 * @async
	 * @param {string} key
	 * @returns {Promise}
	 */
	async delete(key: string) {

		this._dict.delete(key);
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

		const saver = this.saver;
		if (!saver) return;

		const now = Date.now();
		const dict = this._dict;

		const saves = [];

		for (const item of dict.values()) {

			if (item instanceof Cache) {

				//subcache.
				saves.push(item.backup(time));

			} else if (item && item.dirty && (now - item.lastSave) > time) {

				saves.push(saver(this._cacheKey + item.key, item.data).then(
					null, err => err
				));

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

		const saver = this.saver;
		if (!saver) return this._cleanNoSave(time);

		const now = Date.now();
		const dict = this._dict;

		const saves = [];

		for (const k in dict) {

			const item = dict.get(k);
			if (item instanceof Cache) {

				saves.push(item.cleanup(time));

			} else if (item && now - item.lastAccess > time) {

				// done first to prevent race conditions on save.
				dict.delete(k);

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

		const now = Date.now();
		const dict = this._dict;

		for (const k in dict) {

			const item = dict.get(k);
			if (item instanceof Cache) {

				item._cleanNoSave(time);

			} else if (item && now - item.lastAccess > time) {
				dict.delete(k);
			}

		} // for

	}

	/**
	 * Remove an item from cache, without deleting it from the data store.
	 * @param {string} key
	 */
	free(key: string) { this._dict.delete(key); }


	/**
	 * Checks if the keyed data exists in cache or data store.
	 * @async
	 * @param {string} key
	 * @returns {Promise<boolean>}
	 */
	async exists(key: string) {

		if (this._dict.has(key)) return true;

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
		return this._dict.has(key);
	}

	/**
	 * Convert a cache key into valid cacheKey format.
	 * @param {string} key
	 * @returns {string}
	 */
	_fixKey(key: string) {
		if (typeof key !== 'string') return this._separator;
		if (key.length === 0 || key.charAt(key.length - 1) !== this._separator) return key + this._separator;
		return key;
	}

	/**
	 * Create a key for a subcache.
	 * @param {string} parentKey
	 * @param {string} key
	 * @returns {string} key created.
	 */
	_subkey(parentKey: string = this._separator, key: string = '') {
		return parentKey + this._fixKey(key);
	}

}