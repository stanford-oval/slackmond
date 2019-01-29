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

const db = require('../util/db');

const nshards = require('../config').THINGENGINE_MANAGER_ADDRESS.length;

function create(client, user) {
    return db.insertOne(client, `insert into users set ?`, [user]).then((id) => {
        user.id = id;
        return user;
    });
}

module.exports = {
    get(client, id) {
        return db.selectOne(client, "select u.* from users u where u.id = ?", [id]);
    },

    getByName(client, username) {
        return db.selectAll(client, "select u.* from users u where username = ?", [username]);
    },

    getByCloudId(client, cloudId) {
        return db.selectAll(client, "select u.* from users u where cloud_id = ?", [cloudId]);
    },

    create,

    update(client, id, user) {
        return db.query(client, "update users set ? where id = ?", [user, id]);
    },
    delete(client, id) {
        return db.query(client, "delete from users where id = ?", [id]);
    }
};
