// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const mysql = require('mysql');

const Config = require('../config');

function ninvoke(obj, method, ...args) {
    return new Promise((resolve, reject) => {
        obj[method](...args, (err, ...results) => {
            if (err)
                reject(err);
            else if (results.length > 1)
                resolve(results);
            else if (results.length === 1)
                resolve(results[0]);
            else
                resolve();
        });
    });
}

function query(client, string, args) {
    return ninvoke(client, 'query', string, args);
}

function rollback(client, err, done) {
    return query(client, 'rollback').then(() => {
        done();
    }, (rollerr) => {
        done(rollerr);
    });
}


function selectAll(client, string, args) {
    return query(client, string, args).then(([rows, fields]) => rows);
}

function selectOne(client, string, args) {
    return selectAll(client, string, args).then((rows) => {
        if (rows.length !== 1) {
            if (rows.length === 0) {
                const err = new Error("Not Found");
                err.code = 'ENOENT';
                throw err;
            } else {
                throw new Error("Wrong number of rows returned, expected 1, got " + rows.length);
            }
        }

        return rows[0];
    });
}

let _pool;
function getPool() {
    if (_pool === undefined)
        _pool = mysql.createPool(Config.DATABASE_URL);
    return _pool;
}

function connect() {
    return ninvoke(getPool(), 'getConnection').then((connection) => {
        function done(error) {
            if (error !== undefined)
                connection.destroy();
            else
                connection.release();
        }
        return [connection, done];
    });
}

module.exports = {
    getPool,
    connect,
    tearDown() {
        if (_pool === undefined)
            return Promise.resolve();
        const pool = _pool;
        _pool = undefined;
        return new Promise((resolve, reject) => {
            pool.end((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    },

    withClient(callback) {
        return connect().then(([client, done]) => {
            return callback(client).then((result) => {
                done();
                return result;
            }, (err) => {
                done();
                throw err;
            });
        });
    },

    withTransaction(transaction, isolationLevel = 'serializable') {
        return connect().then(async ([client, done]) => {
            // danger! we're pasting strings into SQL
            // this is ok because the argument NEVER comes from user input
            try {
                await query(client, `set transaction isolation level ${isolationLevel}`);
                await query(client, 'start transaction');
                try {
                    const result = await transaction(client);
                    await query(client, 'commit');
                    done();
                    return result;
                } catch(err) {
                    await rollback(client, err, done);
                    throw err;
                }
            } catch (error) {
                done(error);
                throw error;
            }
        });
    },

    insertOne(client, string, args) {
        return query(client, string, args).then(([result, fields]) => {
            if (result.insertId === undefined)
                throw new Error("Row does not have ID");

            return result.insertId;
        });
    },

    insertIgnore(client, string, args) {
        return query(client, string, args).then(([result, fields]) => {
            return result.affectedRows > 0;
        });
    },

    selectOne,
    selectAll,
    query
};
