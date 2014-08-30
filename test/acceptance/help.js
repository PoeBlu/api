var fs = require('fs');
var path = require('path');
var should = require('should');
var connection = require(__dirname + '/../../bantam/lib/model/connection');
var config = require(__dirname + '/../../config');
var request = require('supertest');

var clientCollectionName = config.auth.client_collection || 'client-store';

// create a document with random string via the api
module.exports.createDoc = function (token, done) {
    request('http://' + config.server.host + ':' + config.server.port)
    .post('/vtest/testdb/test-schema')
    .set('Authorization', 'Bearer ' + token)
    .send({field_1: ((Math.random() * 10) | 0).toString()})
    .expect(200)
    .end(function (err, res) {
        if (err) return done(err);

        res.body.length.should.equal(1);
        done(null, res.body[0]);
    });
};

// helper function to cleanup the `serama` db
module.exports.dropDatabase = function (done) {
    connection().on('connect', function (db) {
        db.dropDatabase(done);
    });
};

module.exports.createClient = function (done) {
    var clientStore = connection(config.auth.database);

    clientStore.on('connect', function (db) {
        db.collection(clientCollectionName).insert({
            client_id: 'test123',
            secret: 'super_secret'
        }, done);
    });
};

module.exports.clearCache = function () {

    // all sync stuff
    fs.readdirSync(config.caching.directory).forEach(function (filename) {
        fs.unlinkSync(path.join(config.caching.directory, filename));
    });
}

module.exports.getBearerToken = function (done) {
    module.exports.createClient(function (err) {
        if (err) return done(err);

        request('http://' + config.server.host + ':' + config.server.port)
        .post(config.auth.token_url)
        .send({
            client_id: 'test123',
            secret: 'super_secret'
        })
        .expect(200)
        //.expect('content-type', 'application/json')
        .end(function (err, res) {
            if (err) return done(err);

            var bearerToken = res.body.access_token;
            should.exist(bearerToken);
            done(null, bearerToken);
        });
    });
};
