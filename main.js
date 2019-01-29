// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of slackmond
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const express = require('express');
const http = require('http');
const url = require('url');
const path = require('path');
const morgan = require('morgan');
const favicon = require('serve-favicon');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const csurf = require('csurf');
const errorHandler = require('errorhandler');
const { RTMClient } = require('@slack/client');

const db = require('./util/db');
const secretKey = require('./util/secret_key');

const Config = require('./config');

class SlackHandler {
    constructor() {
        this._client = new RTMClient(Config.SLACK_ACCESS_TOKEN);
        this._client.start();

        // for each new message
        // - lookup user
        // - acquire web almond access token if needed
        // - get or create conversation with web almond
        // - pass message
        let sent = false;
        this._client.on('message', (message) => {
            console.log('Received a slack message', message);

            if (sent)
                return;
            sent = true;
            this._client.sendMessage('Hello there', message.channel).catch((err) => {
                console.error(`Failed to send a message to Slack`);
            });
        });
    }
}

class HttpFrontend {
    constructor() {
        this._app = express();

        this.server = http.createServer(this._app);

        this._app.set('port', process.env.PORT || 8090);
        this._app.set('views', path.join(__dirname, 'views'));
        this._app.set('view engine', 'pug');
        this._app.enable('trust proxy');

        if ('development' === this._app.get('env'))
            this._app.use(errorHandler());
        this._app.use(morgan('dev'));

        this._app.use(bodyParser.urlencoded({ extended: true }));
        this._app.use(cookieParser());

        this._sessionStore = new MySQLStore({}, db.getPool());
        this._app.use(session({ resave: false,
                                saveUninitialized: false,
                                store: this._sessionStore,
                                secret: secretKey.getSecretKey(this._app) }));

        this._app.use(favicon(__dirname + '/public/images/favicon.ico'));
        this._app.use(express.static(path.join(__dirname, 'public'),
                                     { maxAge: 86400000 }));

        this._app.use(csurf({ cookie: false }));
        this._app.use((req, res, next) => {
            res.locals.csrfToken = req.csrfToken();
            next();
        });

        this._app.get('/', (req, res, next) => {
            res.render('index', {
                page_title: req._("Slackmond"),
            });
        });


        // 500 error handler
        this._app.use((err, req, res, next) => {
            if (typeof err.status === 'number') {
                // oauth2orize errors, bodyparser errors
                res.status(err.status).render('error', {
                    page_title: req._("Slackmond - Error"),
                    message: err.expose === false ? req._("Code: %d").format(err.status) : err
                });
            } else if (err.code === 'EBADCSRFTOKEN') {
                // csurf errors
                res.status(403).render('error', {
                    page_title: req._("Slackmond - Forbidden"),
                    message: err,

                    // make sure we have a csrf token in the page
                    // (this error could be raised before we hit the general code that sets it
                    // everywhere)
                    csrfToken: req.csrfToken()
                });
            } else if (err.code === 'ENOENT' || err.errno === 'ENOENT') {
                // util/db errors
                // if we get here, we have a 404 response
                res.status(404).render('error', {
                    page_title: req._("Slackmond - Page Not Found"),
                    message: req._("The requested page does not exist")
                });
            } else {
                // bugs
                console.error(err);
                res.status(500).render('error', {
                    page_title: req._("Slackmond - Internal Server Error"),
                    message: req._("Code: %s").format(err.code || err.sqlState || err.errno)
                });
            }
        });
    }
}

function main() {
    // initialize slack api
    new SlackHandler();

    // initialize tiny express server for OAuth
    new HttpFrontend();

}
main();
