/**
 * Item within the Cache.
 */
export default class Item {

	lastAccess: number;
	lastSave: number;
	dirty: boolean;
	readonly key: string;

	data: any;

	/**
	 * @constructor
	 * @param {string} key 
	 * @param {*} data 
	 * @param {boolean} [dirty=true] 
	 */
	constructor(key: string, data: any, dirty: boolean = true) {

		this.key = key;

		this.lastAccess = Date.now();

		this.dirty = dirty;
		if (dirty) this.lastSave = 0;
		else this.lastSave = this.lastAccess;

		this.data = data;

	}

	/**
	 * Updates the data stored and sets the last access time
	 * to the current time.
	 * @param {*} data - data stored.
	 */
	update(data: any) {

		this.data = data;
		this.lastAccess = Date.now();
		this.dirty = true;

	}

	/**
	 * Mark the data as having been saved at the given time.
	 * @param {number} [time=0] unix timestamp of save time.
	 */
	markSaved(time: number = 0) {
		this.lastSave = time || Date.now();
		this.dirty = false;
	}

}