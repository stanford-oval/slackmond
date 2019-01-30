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

const Tp = require('thingpedia');

const qs = require('qs');
const express = require('express');
const http = require('http');
const path = require('path');
const morgan = require('morgan');
const favicon = require('serve-favicon');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const csurf = require('csurf');
const errorHandler = require('errorhandler');

const userModel = require('../model/user');
const db = require('../util/db');
const secretKey = require('../util/secret_key');
const iv = require('../util/input_validation');

const Config = require('../config');

module.exports = class WebFrontend {
    constructor() {
        this._app = express();

        this.server = http.createServer(this._app);

        this._app.set('port', process.env.PORT || 8090);
        this._app.set('views', path.resolve(__dirname, '../views'));
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

        this._app.use(favicon(path.resolve(__dirname, '../public/images/favicon.ico')));
        this._app.use(express.static(path.resolve(__dirname, '../public'),
                                     { maxAge: 86400000 }));

        this._app.use(csurf({ cookie: false }));
        this._app.use((req, res, next) => {
            res.locals.Config = Config;
            res.locals.csrfToken = req.csrfToken();
            next();
        });

        // TODO i18n/l10n
        this._app.use((req, res, next) => {
            req.locale = 'en-US';
            req.gettext = (x) => x;
            req._ = req.gettext;
            req.pgettext = (c, x) => x;
            req.ngettext = (x, x2, n) => n === 1 ? x : x2;

            res.locals.locale = req.locale;
            res.locals.gettext = req.gettext;
            res.locals._ = req._;
            res.locals.pgettext = req.pgettext;
            res.locals.ngettext = req.ngettext;

            res.locals.timezone = 'America/Los_Angeles';
            next();
        });

        this._app.get('/', (req, res, next) => {
            res.render('index', {
                page_title: req._("Slackmond"),
            });
        });

        this._app.get('/register', iv.validateGET({ slack_id: 'string' }), (req, res, next) => {
            req.session.slack_id = req.query.slack_id;
            res.redirect(302, Config.WEB_ALMOND_URL + '/me/api/oauth2/authorize?' + qs.stringify({
                client_id: Config.ALMOND_CLIENT_ID,
                redirect_uri: Config.SERVER_ORIGIN + '/oauth-redirect',
                response_type: 'code',
                scope: 'profile user-read user-read-results user-exec-command'
            }));
        });

        this._app.get('/oauth-redirect', async (req, res, next) => {
            try {
                if (!req.session.slack_id) {
                    res.render('error', {
                        page_title: req._("Slackmond - Error"),
                        message: req._("I don't recognize you. You must click on the appropriate link in the Slack app to register.")
                    });
                    return;
                }

                if (req.query.error) {
                    res.render('error', {
                        page_title: req._("Slackmond - Error"),
                        message: req.query.error
                    });
                } else {
                    const response = JSON.parse(await Tp.Helpers.Http.post(Config.WEB_ALMOND_URL + '/me/api/oauth2/token', qs.stringify({
                        client_id: Config.ALMOND_CLIENT_ID,
                        client_secret: Config.ALMOND_CLIENT_SECRET,
                        redirect_uri: Config.SERVER_ORIGIN + '/oauth-redirect',
                        grant_type: 'authorization_code',
                        code: req.query.code,
                    }), { dataContentType: 'application/x-www-form-urlencoded' }));
                    const profile = JSON.parse(await Tp.Helpers.Http.get(Config.WEB_ALMOND_URL + '/me/api/profile', {
                        auth: `Bearer ${response.access_token}`
                    }));

                    await db.withTransaction(async (dbClient) => {
                        let [user] = await userModel.getBySlackId(dbClient, req.session.slack_id);
                        if (user) {
                            await userModel.update(dbClient, user.id, {
                                almond_id: profile.id,
                                access_token: response.access_token,
                                refresh_token: response.refresh_token
                            });
                        } else {
                            await userModel.create(dbClient, {
                                slack_id: req.session.slack_id,
                                username: profile.username,
                                human_name: profile.human_name,
                                almond_id: profile.id,
                                access_token: response.access_token,
                                refresh_token: response.refresh_token
                            });
                        }
                    });

                    res.render('message', {
                        page_title: req._("Slackmond - Authenticated"),
                        message: req._("You are now successfully authenticated to Almond, and you can use your personal accounts in Slack.")
                    });
                }
            } catch(e) {
                next(e);
            }
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

    start() {
        // '::' means the same as 0.0.0.0 but for IPv6
        // without it, node.js will only listen on IPv4
        return new Promise((resolve, reject) => {
            this.server.listen(this._app.get('port'), '::', (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        }).then(() => {
            console.log('Express server listening on port ' + this._app.get('port'));
        });
    }
};
