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

const { WebClient } = require('@slack/client');
const { createEventAdapter } = require('@slack/events-api');

const Config = require('./config');

function main() {
    // initialize slack api
    const client = new WebClient(Config.SLACK_ACCESS_TOKEN);

    const eventAdapter = createEventAdapter(Config.SLACK_SIGNING_SECRET);

    // for each new message
    // - lookup user
    // - acquire web almond access token if needed
    // - get or create conversation with web almond
    // - pass message
    eventAdapter.on('message', (event) => {
        console.log('Received a slack message', event);

        client.chat.postMessage({ channel: event.channel, text: 'Hello there' });
    });
}
