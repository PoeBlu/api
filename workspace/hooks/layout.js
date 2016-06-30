var url = require('url')

module.exports = function (obj, type, data) {
  var queryParameters = url.parse(data.req.url, true).query
  var resolveLayout = (queryParameters.resolveLayout !== 'false')

  if (data.schema && data.schema.layout && data.schema.layout.schema) {
    switch (type) {
      case 'afterGet':
        if (resolveLayout) {
          obj.results.forEach((document) => {
            document = resolve(data.schema.layout.schema, document)
          })          
        }

        // Attaching layout schema to metadata
        obj.metadata.layout = data.schema.layout.schema

        break

      case 'beforeCreate':
      case 'beforeUpdate':
        var validationErrors = validate(data.schema.layout.schema, obj)

        if (validationErrors) {
          return Promise.reject(validationErrors)
        }

        break
    }
  }

  return obj
}

// --------------------------
// Layout resolve
// --------------------------

function resolve(layoutSchema, document) {
  var result = []
  var freeSections = []

  if (!document.layout) return document

  // Add fixed fields
  layoutSchema.forEach(function (block, index) {
    if (!block.source && !block.free) return

    if (block.free) {
      freeSections.push({
        displayName: block.displayName,
        position: index,
        name: block.name
      })
    } else {
      result.push({
        content: document.hasOwnProperty(block.source) ? document[block.source] : null,
        type: block.source
      })
    }
  })

  // Add free fields
  if (freeSections.length) {
    var counter = 0

    Object.keys(document.layout).forEach(function (section) {
      var schemaSection = freeSections.find(function (obj) {
        return (obj.name === section)
      })

      document.layout[section].forEach(function (block, blockIndex) {
        result.splice(schemaSection.position + blockIndex + counter, 0, {
          content: document[block.source][block.index],
          displayName: schemaSection.displayName,
          free: true,
          name: schemaSection.name,
          type: block.source
        })
      })

      counter += section.length - 1
    })
  }

  document.layout = result

  return document	
}

// --------------------------
// Layout validation
// --------------------------

function validate(layoutSchema, document) {
  var errors = []
  var fieldCount = []
  var freeFieldsSections = layoutSchema.filter(function (elem) {
    return elem.free
  })

  Object.keys(document.layout).forEach((function (section) {
    var schemaSection = freeFieldsSections.find(function (obj) {
      return (obj.name === section)
    })

    if (!schemaSection) return

    if (!fieldCount[section]) {
      fieldCount[section] = {}
    }

    document.layout[section].forEach((function (block, blockIndex) {
      var freeField = schemaSection.fields.find(function (elem) {
        return elem.source === block.source
      })

      // Check if field is part of `free`
      if (!freeField) {
        return errors.push({field: 'layout', message: 'Layout section \'' + schemaSection.name + '\' does not accept \'' + block.source + '\' as a free field'})
      }

      // Check if `index` is within bounds
      if (!document[block.source] instanceof Array || (document[block.source].length <= block.index)) {
        return errors.push({field: 'layout', message: block.index + ' is not a valid index for field ' + block.source})
      }

      // Increment the field count and check for limits
      if (fieldCount[section][block.source]) {
        fieldCount[section][block.source]++
      } else {
        fieldCount[section][block.source] = 1
      }
    }).bind(this))
  }).bind(this))

  var free = layoutSchema.filter(function (elem) {
    return elem.free
  })

  free.forEach(function (section) {

    section.fields.forEach(function (field) {
      var count = (fieldCount[section.name] && fieldCount[section.name][field.source]) ? fieldCount[section.name][field.source] : 0

      // Check for `min` limit
      if (field.min && (count < field.min)) {
        errors.push({field: 'layout', message: 'Layout section \'' + section.name + '\' must contain at least ' + field.min + ' instances of \'' + field.source + '\''})
      }

      // Check for `max` limit
      if (field.max && (count > field.max)) {
        errors.push({field: 'layout', message: 'Layout section \'' + section.name + '\' cannot contain more than ' + field.max + ' instances of \'' + field.source + '\''})
      }
    })
  })

  if (errors.length) return errors
}