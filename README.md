# Archcache


Simple In-Memory Cache with callbacks to save, load, and revive from a background store.

Caches can store subcaches to retrieve items in a hierarchical manner.


```
const cache = new Cache({

    /// Base key prepended to items added to this cache.
    /// cacheKeys of subcaches are concatenated and prefixed to an item's key.
    cacheKey: '',
    loader( cacheKey:string ){
        /// Load item by key from backing store.
    },
    reviver( data:string ){
        /// Revive data loaded from backing store.
    },
    saver( cacheKey:string, data:any ){
        /// ... save data stored at key.
    },
    checker( cacheKey:string ){
        /// Determine if keyed object exists in backing store.
    },
    deleter( cacheKey:string ){
        /// Delete item from backing store
    }


});

```