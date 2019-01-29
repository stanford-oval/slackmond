#!/bin/bash

## Integration tests for Web Almond against public Thingpedia
## (API, web pages)

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

DATABASE_URL="mysql://slackmond:slackmond@localhost/slackmond_test"
export DATABASE_URL

if ! test -f $srcdir/secret_config.js ; then
	cat > $srcdir/secret_config.js <<'EOF'
module.exports.WEB_ALMOND_URL = 'https://almond-dev.stanford.edu';
module.exports.THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';
EOF
fi

# clean the database and bootstrap
$srcdir/scripts/execute-sql-file.js $srcdir/model/schema.sql

workdir=`mktemp -t -d webalmond-integration-XXXXXX`
workdir=`realpath $workdir`
on_error() {
    test -n "$masterpid" && kill $masterpid || true
    masterpid=
    wait

    # remove workdir after the processes have died, or they'll fail
    # to write to it
    rm -fr $workdir
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

node $srcdir/main.js &
masterpid=$!

# in interactive mode, sleep forever
# the developer will run the tests by hand
# and Ctrl+C
if test "$1" = "--interactive" ; then
    sleep 84600
else
    # sleep until both processes are settled
    sleep 30

    # do some tests
fi

kill $masterpid
masterpid=
wait

rm -rf $workdir
