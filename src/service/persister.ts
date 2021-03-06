/// <reference path="utils.ts" />
/// <reference path="../common/models.ts" />
/// <reference path="../common/messaging.ts" />
/// <reference path="../../typings/tsd.d.ts" />
/// <reference path="interfaces.ts"/>
/// <reference path="config.ts"/>

import Models = require("../common/models");
import Messaging = require("../common/messaging");
import Utils = require("./utils");
import _ = require("lodash");
import mongodb = require('mongodb');
import Q = require("q");
import moment = require('moment');
import Interfaces = require("./interfaces");
import Config = require("./config");

export function loadDb(config: Config.IConfigProvider) {
    var deferred = Q.defer<mongodb.Db>();
    mongodb.MongoClient.connect(config.GetString("MongoDbUrl"), (err, db) => {
        if (err) deferred.reject(err);
        else deferred.resolve(db);
    });
    return deferred.promise;
}

export interface Persistable {
    time?: moment.Moment|Date;
    pair?: Models.CurrencyPair;
    exchange?: Models.Exchange;
}

export class LoaderSaver {
    public loader = (x: Persistable) => {
        if (typeof x.time !== "undefined")
            x.time = moment.isMoment(x.time) ? x.time : moment(x.time);
        if (typeof x.exchange === "undefined")
            x.exchange = this._exchange;
        if (typeof x.pair === "undefined")
            x.pair = this._pair;
    };

    public saver = (x: Persistable) => {
        if (typeof x.time !== "undefined")
            x.time = (moment.isMoment(x.time) ? <moment.Moment>x.time : moment(x.time)).toDate();
        if (typeof x.exchange === "undefined")
            x.exchange = this._exchange;
        if (typeof x.pair === "undefined")
            x.pair = this._pair;
    };

    constructor(private _exchange: Models.Exchange, private _pair: Models.CurrencyPair) { }
}

export interface IPersist<T> {
    persist(data: T): void;
}

export interface ILoadLatest<T> extends IPersist<T> {
    loadLatest(): Q.Promise<T>;
}

export interface ILoadAll<T> extends IPersist<T> {
    loadAll(limit?: number, start_time?: moment.Moment): Q.Promise<T[]>;
}

export class RepositoryPersister<T extends Persistable> implements ILoadLatest<T> {
    _log: Utils.Logger = Utils.log("tribeca:exchangebroker:repopersister");

    public loadLatest = (): Q.Promise<T> => {
        var deferred = Q.defer<T>();

        this.collection.then(coll => {
            var selector = { exchange: this._exchange, pair: this._pair };
            coll.find(selector, { fields: { _id: 0 } }).limit(1).sort({ $natural: -1 }).toArray((err, arr) => {
                if (err) {
                    deferred.reject(err);
                }
                else if (arr.length === 0) {
                    deferred.resolve(this._defaultParameter);
                }
                else {
                    var v = <T>_.defaults(arr[0], this._defaultParameter);
                    this._loader(v);
                    deferred.resolve(v);
                }
            });
        }).done();

        return deferred.promise;
    };

    public persist = (report: T) => {
        this._saver(report);
        this.collection.then(coll => {
            coll.insert(report, err => {
                if (err)
                    this._log("Unable to insert into %s %s; %o", this._dbName, report, err);
            });
        }).done();
    };

    collection: Q.Promise<mongodb.Collection>;
    constructor(
        db: Q.Promise<mongodb.Db>,
        private _defaultParameter: T,
        private _dbName: string,
        private _exchange: Models.Exchange,
        private _pair: Models.CurrencyPair,
        private _loader: (p: Persistable) => void,
        private _saver: (p: Persistable) => void) {
        this.collection = db.then(db => db.collection(this._dbName));
    }
}

export class Persister<T extends Persistable> implements ILoadAll<T> {
    _log: Utils.Logger = Utils.log("tribeca:exchangebroker:persister");

    public loadAll = (limit?: number, start_time?: moment.Moment): Q.Promise<T[]> => {
        var selector = { exchange: this._exchange, pair: this._pair };
        if (start_time) {
            selector["time"] = { $gte: start_time.toDate() };
        }

        return this.loadInternal(selector, limit);
    };

    private loadInternal = (selector: any, limit?: number) => {
        var deferred = Q.defer<T[]>();

        this.collection.then(coll => {
            coll.count(selector, (err, count) => {
                if (err) deferred.reject(err);
                else {

                    var options: any = { fields: { _id: 0 } };
                    if (limit !== null) {
                        options.limit = limit;
                        if (count !== 0)
                            options.skip = Math.max(count - limit, 0);
                    }

                    coll.find(selector, options, (err, docs) => {
                        if (err) deferred.reject(err);
                        else {
                            docs.toArray((err, arr) => {
                                if (err) deferred.reject(err);
                                else {
                                    _.forEach(arr, this._loader);
                                    deferred.resolve(arr);
                                }
                            })
                        }
                    })
                }
            });

        }).done();

        return deferred.promise;
    };

    public persist = (report: T) => {
        this._saver(report);
        this.collection.then(coll => {
            coll.insert(report, err => {
                if (err)
                    this._log("Unable to insert into %s %s; %o", this._dbName, report, err);
            });
        }).done();
    };

    collection: Q.Promise<mongodb.Collection>;
    constructor(
        db: Q.Promise<mongodb.Db>,
        private _dbName: string,
        private _exchange: Models.Exchange,
        private _pair: Models.CurrencyPair,
        private _loader: (p: Persistable) => void,
        private _saver: (p: Persistable) => void) {
        this.collection = db.then(db => db.collection(this._dbName));
    }
}