// Validation should:
//   ensure that no queries use `$` operators at top level
//   ensure that all objects are JSON
//   ensure that field validation passes for inserts and updates

var moment = require('moment');
var ObjectID = require('mongodb').ObjectID;
var _ = require('underscore');
var util = require('util');

var log = require(__dirname + '/../log');
log.info({module: 'validator'}, 'Model validator logging started.');

var ignoredKeys = ['apiVersion', 'v', 'history']

var Validator = function (model) {
  this.model = model;
};

Validator.prototype.query = function (query) {
  var valid = Object.keys(query).every(function (key) {
    return key !== '$where';
  });

  var response = valid ? { success: true } : { success: false, errors: [{message: 'Bad query'}] };

  return response;
};

Validator.prototype.schema = function (obj, update) {
  update = update || false;

  // `obj` must be a "hash type object", i.e. { ... }
  if (typeof obj !== 'object' || util.isArray(obj) || obj === null) return false;

  var response = {
    success: true,
    errors: []
  };

  var schema = this.model.schema;

  // check for default fields, assign them if the obj didn't
  // provide a value (unless we're updating a document)
  if (!update) {
    Object.keys(schema)
    .filter(function (key) { return schema[key].default; })
    .forEach(function (key) {
      if (!obj.hasOwnProperty(key)) {
        obj[key] = schema[key].default;
      }
    });
  }

  // check that all required fields are present
  Object.keys(schema)
  .filter(function (key) { return schema[key].required; })
  .forEach(function (key) {
    // if it's an insert and a required field isn't found, error
    if (!obj.hasOwnProperty(key) && !update) {
      response.success = false;
      response.errors.push({field: key, message: 'must be specified'});
    }
    // if it's a required field and is blank or null, error
    else if (obj.hasOwnProperty(key) && (typeof obj[key] === 'undefined' || obj[key] === '')) {
      response.success = false;
      response.errors.push({field: key, message: 'can\'t be blank'});
    }
  });

  // check all `obj` fields
  _parseDocument(obj, schema, response);
  return response;
};

function _parseDocument (obj, schema, response) {
  var keys = _.difference(Object.keys(obj), ignoredKeys)

  keys.forEach(function (key) {
    // handle objects first
    if (typeof obj[key] === 'object') {
      if (schema[key] && (schema[key].type === 'Mixed' || schema[key].type === 'Object')) {
        // do nothing
      }
      else if (schema[key] && schema[key].type === 'Reference') {
        // bah!
      }
      else if (obj[key] !== null && !util.isArray(obj[key])) {
        _parseDocument(obj[key], schema, response)
      }
      else if (obj[key] !== null && schema[key] && schema[key].type === 'ObjectID' && util.isArray(obj[key])) {
        var err = _validate(obj[key], schema[key], key)

        if (err) {
          response.success = false
          response.errors.push({field: key, message: err})
        }
      }
      else if (util.isArray(obj[key]) && schema[key] && (schema[key].type === 'String')) {
        // We allow type `String` to actually be an array of Strings. When this
        // happens, we run the validation against the combination of all strings
        // glued together.

        var err = _validate(obj[key].join(''), schema[key], key)

        if (err) {
          response.success = false
          response.errors.push({field: key, message: err})
        }
      }
    } else {
      if (!schema[key]) {
        response.success = false
        response.errors.push({field: key, message: "doesn't exist in the collection schema"})
        return
      }

      var err = _validate(obj[key], schema[key], key)

      if (err) {
        response.success = false
        response.errors.push({field: key, message: err})
      }
    }
  })
}

function _validate(field, schema, key) {
    if (schema.hasOwnProperty('validation')) {
      var validationObj = schema.validation;

      if (validationObj.hasOwnProperty('regex') && validationObj.regex.hasOwnProperty('pattern') && !(new RegExp(validationObj.regex.pattern).test(field))) return schema.message || 'should match the pattern ' + validationObj.regex.pattern;

      if (validationObj.hasOwnProperty('minLength') && field.toString().length < Number(validationObj.minLength)) return schema.message || 'is too short';
      if (validationObj.hasOwnProperty('maxLength') && field.toString().length > Number(validationObj.maxLength)) return schema.message || 'is too long';
    }

    var primitives = ['String', 'Number', 'Boolean', 'Array', 'Date', 'DateTime'];

    // check length
    if (schema.limit) {
      var newSchema = {};
      newSchema[key] = _.clone(schema);
      newSchema[key].validation = { maxLength: schema.limit };
      delete newSchema[key].limit;
      var message = 'The use of the `limit` property in field declarations is deprecated and was removed in v1.8.0\n\nPlease use the following instead:\n\n';
      message += JSON.stringify(newSchema, null, 2);
      log.warn(message);
      throw new Error(message);
    }

    // check validation regex
    if (schema.validationRule) {
      var newSchema = {};
      newSchema[key] = _.clone(schema);
      newSchema[key].validation = { regex: { pattern: schema.validationRule }};
      delete newSchema[key].validationRule;
      var message = 'The use of the `validationRule` property in field declarations is deprecated and was removed in v1.8.0\n\nPlease use the following instead:\n\n';
      message += JSON.stringify(newSchema, null, 2);
      log.warn(message);
      throw new Error(message);
    }

    if (schema.type === 'ObjectID') {
        if (typeof field === 'object' && _.isArray(field)) {
            for (var i = field.length - 1; i >= 0; i--) {
                var val = field[i];
                if (typeof val !== 'string' || !ObjectID.isValid(val)) {
                    return val + ' is not a valid ObjectID';
                }
            }
        }
        else if (typeof field === 'string') {
            if (!ObjectID.isValid(field)) return 'is not a valid ObjectID';
        }
        else {
            return 'is wrong type';
        }
    }

    if (schema.type === 'DateTime') {
      var m = moment(field)
      if (!m.isValid()) {
        return 'is not a valid DateTime';
      }
    }

    // allow Mixed/ObjectID/Reference/DateTime fields through
    if (_.contains(['Mixed', 'ObjectID', 'Reference', 'DateTime'], schema.type) === false) {
        // check constructor of field against primitive types and check the type of field == the specified type
        // using constructor.name as array === object in typeof comparisons
        try {
          if(~primitives.indexOf(field.constructor.name) && schema.type !== field.constructor.name) return schema.message || 'is wrong type';
        }
        catch(e) {
          return schema.message || 'is wrong type';
        }
    }

    // validation passes
    return;
}

module.exports = Validator;
