var test = require('tape');
var RestCollectionMixins = require('../ampersand-collection-rest-mixin');
var AmpersandCollection = require('ampersand-collection');
var AmpersandModel = require('ampersand-model');
var Sync = require('ampersand-sync');

// Patch PhantomJS.
if (!Function.prototype.bind) Function.prototype.bind = require('function-bind');

/* global -Promise */
var Promise = require('bluebird');

var SuccessSync = function (method, model, options) {
    options.xhrImplementation = function (xhrOptions) {
        xhrOptions.success();
        return {};
    };
    return Sync.call(this, method, model, options);
};

var PromiseSync = function (method, model, options) {
    options.xhrImplementation = function (xhrOptions) {
        xhrOptions.success();
        return {};
    };

    var boundSync = Sync.bind(this, method, model, options);
    // emulate syncs that implement a promise for fetch
    return Promise.resolve(boundSync());
};

function endAfter (t, after) {
    var count = 0;
    return function () {
        count++;
        if (after === count) {
            t.end();
        }
    };
}

var Model = AmpersandModel.extend({
    props: {
        name: 'string',
        id: 'number'
    },
    sync: function () {
        this.__syncArgs = arguments;
        return AmpersandModel.prototype.sync.apply(this, arguments);
    }
});

var Collection = AmpersandCollection.extend(RestCollectionMixins, {
    model: Model,
    sync: function () {
        this.__syncArgs = arguments;
        return RestCollectionMixins.sync.apply(this, arguments);
    }
});

test('Existence of methods', function (t) {
    t.plan(5);

    var collection = new Collection();

    t.ok(typeof collection.fetch === 'function');
    t.ok(typeof collection.create === 'function');
    t.ok(typeof collection.sync === 'function');
    t.ok(typeof collection.getOrFetch === 'function');
    t.ok(typeof collection.fetchById === 'function');

    t.end();
});

// ============================
// Tested ported from Backbone
// that have to do with REST stuff
// ============================

test('Fetch', function (t) {
    t.plan(4);

    var collection = new Collection();
    collection.url = '/test';
    collection.fetch();

    t.equal(collection.__syncArgs[0], 'read');
    t.equal(collection.__syncArgs[1], collection);
    t.equal(collection.__syncArgs[2].parse, true);

    collection.fetch({parse: false});
    t.equal(collection.__syncArgs[2].parse, false);

    t.end();
});

test('fetch with an error response triggers an error event', function (t) {
    t.plan(1);

    var collection = new Collection();
    collection.on('error', function () {
        t.ok(true);
        t.end();
    });

    collection.sync = function (method, model, options) { options.error(); };
    collection.fetch();
});

test('set: false - disable setting response onto collection', function(t){
    t.plan(2);
    var end = endAfter(t, 2);

    var model = new Model({name: 'foo'});
    var collection = new Collection();

    var opts = {
        set: false,
        success: function (collection, resp) {
            t.equal(collection.models.length, 0, '`set: false` does not set models on collection');
            t.ok(resp);
            end();
        }
    };
    collection.sync = model.sync = function (method, collection, options) {
        options.success(collection, [], options);
    };

    collection.fetch(opts);

});

test('ensure fetch only parses once', function (t) {
    t.plan(1);

    var collection = new Collection();

    var counter = 0;
    collection.parse = function(models) {
        counter++;
        return models;
    };
    collection.url = '/test';
    collection.fetch();

    collection.__syncArgs[2].success();

    t.equal(counter, 1);
    t.end();
});

test('create', function (t) {
    t.plan(4);

    var collection = new Collection();
    collection.url = '/test';

    var model = collection.create({name: 'f'}, {wait: true});

    t.equal(model.__syncArgs[0], 'create');
    t.equal(model.__syncArgs[1], model);
    t.equal(model.name, 'f');
    t.equal(model.collection, collection);

    t.end();
});

test('doing something with the result of the fetch', function(t){
    t.plan(1);

    var SuccessModel = Model.extend({
        url: 'http://foo.bar/item',
        sync: PromiseSync
    });

    var SuccessCollection = Collection.extend({
        url: 'http://foo.bar/items',
        sync: PromiseSync,
        model: SuccessModel
    });

    var fetchingStuff = [
        new SuccessModel().fetch(),
        new SuccessCollection().fetch(),
        new SuccessCollection().fetchById(1),
        new SuccessCollection().getOrFetch(1)
    ];
    Promise.all(fetchingStuff).then(function(data){
        t.equal(data.length, 4);
        t.end();
    });
});

test('create with validate:true enforces validation', function (t) {
    t.plan(3);

    var ValidatingModel = Model.extend({
        validate: function () {
            return 'fail';
        }
    });

    var ValidatingCollection = Collection.extend({
        model: ValidatingModel
    });

    var collection = new ValidatingCollection();

    collection.on('invalid', function (collection, error) {
        t.equal(error, 'fail');
    });

    t.equal(collection.create({name: 'foo'}, {validate: true}), false);
    t.equal(collection.length, 0);

    t.end();
});

test('a failing create returns model with errors', function (t) {
    t.plan(2);

    var ValidatingModel = Model.extend({
        validate: function () {
            return 'fail';
        }
    });

    var ValidatingCollection = Collection.extend({
        model: ValidatingModel
    });

    var collection = new ValidatingCollection();

    var model = collection.create({name: 'bar'});

    t.equal(model.validationError, 'fail');
    t.equal(collection.length, 1);
    t.end();
});

test('#714: access `model.collection` in a brand new model.', function (t) {
    t.plan(2);

    var collection = new Collection();
    collection.url = '/test';

    var model = Model.extend({
        set: function(attrs) {
            t.equal(attrs.name, 'value');
            t.equal(this.collection, collection);
            t.end();
        }
    });

    collection.model = model;
    collection.create({name: 'value'});
});

test('#1355 - `options` is passed to success callbacks', function (t) {
    t.plan(2);
    var end = endAfter(t, 2);

    var model = new Model({name: 'foo'});
    var collection = new Collection();

    var opts = {
        success: function (collection, resp, options){
            t.ok(options);
            end();
        }
    };
    collection.sync = model.sync = function (method, collection, options) {
        options.success(collection, [], options);
    };

    collection.fetch(opts);
    collection.create(model, opts);
});

test('#1412 - Trigger request events.', function (t) {
    t.plan(2);
    var end = endAfter(t, 2);

    var collection = new Collection();
    collection.url = '/test';

    collection.on('request', function (obj) {
        t.ok(obj === collection, 'collection has correct request event after fetching');
        end();
    });
    collection.fetch();
    collection.off();

    collection.on('request', function (obj) {
        t.ok(obj === collection.get(1), 'collection has correct request event after one of its models save');
        end();
    });
    collection.create({id: 1});
    collection.off();
});

test('#1412 - Trigger sync events.', function (t) {
    t.plan(2);
    var end = endAfter(t, 2);

    var SuccessModel = Model.extend({
        sync: SuccessSync
    });

    var SuccessCollection = Collection.extend({
        sync: SuccessSync,
        model: SuccessModel
    });
    var collection = new SuccessCollection();
    collection.url = '/test';

    collection.on('sync', function (obj) {
        t.ok(obj === collection, 'collection has correct sync event after fetching');
        end();
    });
    collection.fetch();
    collection.off();

    collection.on('sync', function (obj) {
        t.ok(obj === collection.get(1), 'collection has correct sync event after one of its models save');
        end();
    });
    collection.create({id: 1});
    collection.off();
});

test('#1447 - create with wait adds model.', function (t) {
    t.plan(1);

    var collection = new Collection();
    var model = new Model();

    model.sync = function (method, model, options) { options.success(); };

    collection.on('add', function() {
        t.ok(true);
        t.end();
    });
    collection.create(model, {wait: true});
});

test('fetch parses models by default', function (t) {
    t.plan(1);

    var model = {};
    var ParseCollection = Collection.extend({
        url: 'test',
        model: Model.extend({
            parse: function (resp) {
                t.strictEqual(resp, model);
                t.end();
            }
        })
    });

    var collection = new ParseCollection();

    collection.fetch();
    collection.__syncArgs[2].success([model]);
});

test('#1939 - `parse` is passed `options`', function (t) {
    t.plan(1);

    var ParseCollection = Collection.extend({
        ajaxConfig: {
            headers: {
                someHeader: 'headerValue'
            }
        },
        parse: function (data, options) {
            t.equal(options.xhr.headers.someheader, 'headerValue');
            t.end();
            return data;
        }
    });

    var collection = new ParseCollection();
    collection.url = '/test';
    collection.fetch();
    collection.__syncArgs[2].success();
});

test('#2606 - Collection#create, success arguments', function (t) {
    t.plan(1);

    var collection = new Collection();
    collection.url = '/test';
    collection.create({}, {
        success: function (model, resp) {
            t.strictEqual(resp, 'response');
            t.end();
        }
    });
    collection.at(0).__syncArgs[2].success('response');
});

test('create with wait, model instance, #3028', function (t) {
    t.plan(1);

    var collection = new Collection();
    var model = new Model({id: 1});
    model.sync = function () {
        t.equal(this.collection, collection);
        t.end();
    };
    collection.create(model, {wait: true});
});

test('fetch call with parameters for ajax call', function (t) {
    t.plan(1);

    var params = {param1 : 'value1', param2 : 'value2'};
    var collection = new Collection();
    collection.url = '/test';
    collection.fetch({data: params});
    t.equal(collection.__syncArgs[2].data, params);

    t.end();
});

test('#15 getOrFetch call with parameters for ajax call', function (t) {
    t.plan(4);

    var collection = new Collection();
    var param = {param: 'value'};
    collection.url = '/test';

    collection.sync = function (param_method, param_collection, param_options) {
        t.equal(param_method, 'read');
        t.equal(param_collection, collection);
        t.equal(param_options.parse, true);
        t.equal(param_options.data, param);

        param_options.success();
    };

    collection.getOrFetch(1, {all: true, data: param}, function (/*err, model*/) {
        t.end();
    });
});

test('#28 When fetchByid\'s model.fetch() returns an error, pass the error details to fetchById\'s caller', function (t) {
    t.plan(2);

    var collection = new Collection();

    var options = {
        error: function (collection, res) {
            t.equal(res.status, 400);
            t.equal(res.statusText, 'Bad Request');
            t.end();
        }
    };

    collection.sync = function (method, model, options) {
        options.error({
            status: 400,
            statusText: 'Bad Request'
        });
    };
    collection.fetch(options);
});

test('#13 getOrFetch call with parameters for ajax call', function (t) {
    t.plan(2);

    var collection = new Collection([{
        id: 1
    }]);

    var syncEventCalled = false;

    collection.on('sync-event', function() {
        t.equal(syncEventCalled, false, 'synchronous event should be called first');
        syncEventCalled = true;
    });

    collection.getOrFetch(1, function () {
        t.equal(syncEventCalled, true, 'sync event should have been called');
        t.end();
    });

    collection.trigger('sync-event');
});
