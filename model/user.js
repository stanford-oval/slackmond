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

    getByAlmondId(client, cloudId) {
        return db.selectAll(client, "select u.* from users u where almond_id = ?", [cloudId]);
    },

    getBySlackId(client, userId) {
        return db.selectAll(client, "select u.* from users u where slack_id = ?", [userId]);
    },

    create,

    update(client, id, user) {
        return db.query(client, "update users set ? where id = ?", [user, id]);
    },
    delete(client, id) {
        return db.query(client, "delete from users where id = ?", [id]);
    }
};
