/**
 * Item within the Cache.
 */
export default class Item {

	/**
	 * @constructor
	 * @param {string} key 
	 * @param {*} data 
	 * @param {boolean} [dirty=true] 
	 */
	constructor( key, data, dirty=true ) {

		this.key = key;

		this.lastAccess = Date.now();

		this.dirty = dirty;
		if ( dirty ) this.lastSave = 0;
		else this.lastSave = this.lastAccess;

		this.data = data;

	}

	/**
	 * 
	 * @param {*} data 
	 */
	update( data ) {

		this.data = data;
		this.lastAccess = Date.now();
		this.dirty = true;

	}

	/**
	 * 
	 * @param {number} [time=0] 
	 */
	markSaved( time=0 ) {
		this.lastSave = time || Date.now();
		this.dirty = false;
	}

}