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

require('./util/polyfill');
process.on('unhandledRejection', (up) => { throw up; });

const WebFrontend = require('./service/web_frontend');
const SlackDispatcher = require('./service/dispatcher');

function main() {
    // initialize slack api
    new SlackDispatcher();

    // initialize tiny express server for OAuth
    const web = new WebFrontend();
    web.start();
}
main();
