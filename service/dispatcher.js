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
const events = require('events');
const qs = require('qs');
const WebSocket = require('ws');
const ConsumerQueue = require('consumer-queue');

const { WebClient, RTMClient } = require('@slack/client');

const db = require('../util/db');
const userModel = require('../model/user');

const Config = require('../config');

const INACTIVITY_TIMEOUT = 60000;

class UserContext extends events.EventEmitter {
    constructor(user, channel, rtmClient, webClient, options) {
        super();

        this._id = 'slack:' + rtmClient.activeTeamId + '/' + user.slack_id + '/' + channel;
        console.log(`Created user context with ID ${this._id}`);

        this._client = rtmClient;
        this._webClient = webClient;
        this._user = user;
        this._channel = channel;
        this._options = options || {};

        this._ws = null;
        // we use two queues (one for user->almond messages and one
        // for almond->user messages) to ensure that messages are correctly
        // ordered, and not discarded in the face of web socket closures/delayed opening
        //
        // incoming/outgoing is from the POV of almond, so
        // incoming === user->almond
        // outgoing === almond->user
        this._incomingMessageQueue = new ConsumerQueue();
        this._outgoingMessageQueue = new ConsumerQueue();
        this._currentAskSpecial = null;
        this._closed = false;

        this._pumpingIncomingMessages = false;
        this._pumpOutgoingMessageQueue();

        this._inactivityTimeout = null;
        this._resetInactivityTimeout();
    }

    handleCommand(command, activate) {
        this._resetInactivityTimeout();
        this._connect();

        let message;
        if (command.startsWith('\\t'))
            message = { type: 'tt', tt: command.substring('\\t '.length) };
        else if (/^\\r +\{/.test(command))
            message = JSON.parse(command.substring('\\r '.length));
        else if (command.startsWith('\\r'))
            message = { type: 'parsed', code: command.substring('\\r '.length).split(' '), entities: {} };
        else
            message = { type: 'command', text: command };

        console.log(`Context ${this._id}: queued Almond input`, message);
        this._incomingMessageQueue.push({ message, activate });
        console.log(message);
        console.log(activate);
    }

    close() {
        this._closed = true;
        if (this._ws !== null) {
            this._ws.close();
        } else {
            console.log("No websocket to close. ");
        }
    }

    _connect() {
        if (this._ws !== null)
            return;
        this._doConnect().catch((e) => this.emit('error', e));
    }

    async _refreshToken() {
        const auth1 = `Bearer ${this._user.access_token}`;

        try {
            await Tp.Helpers.Http.get(Config.WEB_ALMOND_URL + '/me/api/profile', { auth: auth1 });
        } catch (e) {
            if (e.code !== 401)
                throw e;

            const refreshed = JSON.parse(await Tp.Helpers.Http.post(Config.WEB_ALMOND_URL + '/me/api/profile'), qs.stringify({
                client_id: Config.ALMOND_CLIENT_ID,
                client_secret: Config.ALMOND_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: this._user.refresh_token
            }), { dataContentType: 'application/x-www-form-urlencoded' });

            await db.withTransaction((dbClient) => {
                const obj = {
                    access_token: refreshed.access_token,
                };
                if (refreshed.refresh_token)
                    obj.refresh_token = refreshed.refresh_token;
                return userModel.update(dbClient, this._user.id, obj);
            });

            this._user.access_token = refreshed.access_token;
            this._user.refresh_token = refreshed.refresh_token;
        }
    }

    async _doConnect() {
        const options = { id: this._id };

        if (!this._options.showWelcome)
            options.hide_welcome = '1';

        const url = Config.WEB_ALMOND_URL + '/me/api/' + (this._user.access_token ? 'conversation' : 'anonymous')
            + '?' + qs.stringify(options);
        console.log(`Context ${this._id}: connecting web socket to ${url}`);

        const headers = {
            'Origin': Config.WEB_ALMOND_URL
        };

        let tempToken = this._user.access_token;
        headers['Authorization'] = `Bearer ` + tempToken;

        this._ws = new WebSocket(url, [], { headers });

        this._ws.on('close', () => {
            console.log(`Context ${this._id}: closed`);
            if (this._ws !== null) {
                this._ws = null;
            } else {
                console.log('No Websocket.');
            }
        });
        this._ws.on('error', (e) => {
            console.error(`Error on Web Almond web socket: ${e.message}`);
        });
        this._ws.on('open', () => {
            console.log(`Context ${this._id}: connected`);
            // wait to process incoming messages until we get the first ask_special
            // this ensures that almond does not get confused by processing a message during initialization
            // (and discarding it)
            this._pumpingIncomingMessages = false;
        });
        this._ws.on('message', (data) => { //Never gets here
            console.log("Message received from Almond!");
            const message = JSON.parse(data);
            this._outgoingMessageQueue.push(message);
        });
    }

    _escapeMessageText(text) {
        return text.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;');
    }

    async _pumpIncomingMessageQueue() {
        this._pumpingIncomingMessages = true;
        try {
            for (; ;) {
                let message = await this._incomingMessageQueue.pop();
                if (!message.activate &&
                    (this._currentAskSpecial === null || this._currentAskSpecial === 'generic')) {
                    console.log(`Context ${this._id}: ignored queued message, activate is false and ask special is ${this._currentAskSpecial}`);
                    continue;
                }

                this._ws.send(JSON.stringify(message.message));
            }
        } catch (e) {
            console.error(`Error on Web Almond web socket: ${e.message}`);
        }
    }

    async _pumpOutgoingMessageQueue() {
        // TODO: consecutive messages (up to ask special) should be collapsed into a single rich
        // slack message
        for (; ;) {
            let message = await this._outgoingMessageQueue.pop();
            try {
                switch (message.type) {
                    case 'text':
                        await this._client.sendMessage(message.text, this._channel);
                        break;

                    case 'picture':
                        await this._webClient.chat.postMessage({
                            channel: this._channel,
                            as_user: true,
                            text: '',
                            attachments: [{
                                fallback: "Almond sends a picture: " + message.url,
                                image_url: message.url
                            }]
                        });
                        break;

                    case 'rdl':
                        await this._webClient.chat.postMessage({
                            channel: this._channel,
                            as_user: true,
                            text: '',
                            attachments: [{
                                fallback: message.rdl.displayTitle,
                                title: message.rdl.displayTitle,
                                title_link: message.rdl.webCallback,
                                text: message.rdl.displayText || '',
                            }]
                        });
                        break;

                    case 'choice':
                        // TODO use buttons rather than text
                        await this._client.sendMessage("Choice: " + message.text, this._channel);
                        break;

                    case 'button':
                        await this._client.sendMessage("Button: " + message.title, this._channel);
                        break;

                    case 'link': {
                        let url = message.url;
                        if (url === '/apps')
                            url = Config.WEB_ALMOND_URL + '/me';
                        else if (url === '/user/register')
                            url = Config.SERVER_ORIGIN + '/register?' + qs.stringify({ slack_id: this._user.slack_id });
                        else
                            url = Config.WEB_ALMOND_URL + url;

                        let text = message.title;
                        if (message.url === '/user/register')
                            text = "Log in to Web Almond";
                        await this._webClient.chat.postMessage({
                            channel: this._channel,
                            as_user: true,
                            text: '',
                            attachments: [{
                                fallback: message.title + " at " + message.url,
                                actions: [{
                                    type: 'button',
                                    text, url
                                }]
                            }]
                        });
                        break;
                    }

                    case 'askSpecial':
                        console.log(`Context ${this._id}, askSpecial = ${message.ask}`);
                        this._currentAskSpecial = message.ask;
                        if (!this._pumpingIncomingMessages)
                            this._pumpIncomingMessageQueue();
                        // TODO convert into a button
                        break;
                }
            } catch (e) {
                console.error(`Failed to send message to Slack: ${e.message}`);
            }
        }
    }

    _resetInactivityTimeout() {
        if (this._inactivityTimeout)
            clearTimeout(this._inactivityTimeout);
        this._inactivityTimeout = setTimeout(() => this.emit('inactive'), INACTIVITY_TIMEOUT);
    }
}

module.exports = class SlackDispatcher {
    constructor() {
        this._client = new RTMClient(Config.SLACK_ACCESS_TOKEN);
        this._client.start();
        this._webClient = new WebClient(Config.SLACK_ACCESS_TOKEN);

        // for each new message
        // - lookup user
        // - acquire web almond access token if needed
        // - get or create conversation with web almond
        // - pass message
        this._client.on('message', (message) => {
            console.log('Received a slack message', message);

            // see https://api.slack.com/events/message
            // for the format of `message`
            //
            // message.subtype is set on join/leave messages,
            // file uploads, /me, topic/purpose changes,
            // message changes/deletions, pin/unpin
            // we ignore all of them
            //
            // we also ignore hidden messages
            if (message.type !== 'message' || message.subtype || message.hidden)
                return;

            this._dispatchMessage(message).catch((e) => {
                console.error('Failed to dispatch Slack message', e);
            });
        });

        this._userContexts = new Map;
    }

    async _dispatchMessage(message) {
        let command = message.text;

        // if the user tags Almond explicitly, the message will come out
        // as <@XXXX> where XXXX is the opaque user ID
        const tag = '<@' + this._client.activeUserId + '>';
        console.log('Activate Tag: ' + tag);
        // if the user tags Almond, Almond will wake up and react to any command, otherwise
        // it will only react to replies he expect
        const activate = command.indexOf(tag) >= 0;
        // strip the tag at the front, so we can handle \\r and \\t
        if (command.startsWith(tag))
            command = command.substring(tag.length);
        command = command.trim();

        const ctx = await this._getOrCreateUserContext(message.user, message.channel, activate);
        if (ctx)
            await ctx.handleCommand(command, activate);
    }

    _getOrCreateUser(userId) {
        return db.withTransaction(async (dbClient) => {
            let newlyCreated = false;
            let [user] = await userModel.getBySlackId(dbClient, userId);
            if (!user) {
                const slackUser = await this._webClient.users.info({ user: userId });
                user = await userModel.create(dbClient, {
                    slack_id: userId,
                    username: slackUser.user.name,
                    human_name: slackUser.user.real_name
                });
                newlyCreated = true;
            }
            return [user, newlyCreated];
        });
    }

    async _getOrCreateUserContext(userId, channelId, activate) {
        const key = userId + '/' + channelId;
        let ctx = this._userContexts.get(key);
        if (ctx)
            return ctx;

        if (!activate) {
            console.log(`No context for ${key}, and activate is false`);
            return null;
        }

        const [user, newlyCreated] = await this._getOrCreateUser(userId);
        ctx = new UserContext(user, channelId, this._client, this._webClient, {
            showWelcome: newlyCreated
        });
        ctx.on('inactive', () => {
            ctx.close();
            this._userContexts.delete(key);
        });
        this._userContexts.set(key, ctx);
        return ctx;
    }
};
