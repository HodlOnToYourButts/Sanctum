#!/bin/bash

set -e

echo "Setting up CouchDB for Sanctum CMS..."

COUCHDB_URL=${COUCHDB_URL:-"http://localhost:5984"}
COUCHDB_USERNAME=${COUCHDB_USERNAME:-"admin"}
COUCHDB_PASSWORD=${COUCHDB_PASSWORD:-"password"}
CMS_DATABASE=${CMS_DATABASE:-"sanctumcms"}

echo "Checking CouchDB connection..."
curl -s "${COUCHDB_URL}/" > /dev/null || {
    echo "Error: Cannot connect to CouchDB at ${COUCHDB_URL}"
    exit 1
}

echo "Creating database: ${CMS_DATABASE}"
curl -X PUT "${COUCHDB_URL}/${CMS_DATABASE}" \
    -u "${COUCHDB_USERNAME}:${COUCHDB_PASSWORD}" \
    -H "Content-Type: application/json" || echo "Database may already exist"

echo "Creating design document: content"
curl -X PUT "${COUCHDB_URL}/${CMS_DATABASE}/_design/content" \
    -u "${COUCHDB_USERNAME}:${COUCHDB_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d '{
        "views": {
            "by_type": {
                "map": "function(doc) { if (doc.type && doc.type !== \"user\") { emit(doc.type, doc); } }"
            },
            "by_created": {
                "map": "function(doc) { if (doc.created_at && doc.type !== \"user\") { emit(doc.created_at, doc); } }"
            },
            "by_status": {
                "map": "function(doc) { if (doc.status && doc.type !== \"user\") { emit([doc.status, doc.created_at], doc); } }"
            }
        }
    }' || echo "Content design document may already exist"

echo "Creating design document: users"
curl -X PUT "${COUCHDB_URL}/${CMS_DATABASE}/_design/users" \
    -u "${COUCHDB_USERNAME}:${COUCHDB_PASSWORD}" \
    -H "Content-Type: application/json" \
    -d '{
        "views": {
            "by_email": {
                "map": "function(doc) { if (doc.type === \"user\" && doc.email) { emit(doc.email, doc); } }"
            },
            "by_oidc_id": {
                "map": "function(doc) { if (doc.type === \"user\" && doc.oidc_id) { emit(doc.oidc_id, doc); } }"
            }
        }
    }' || echo "Users design document may already exist"

echo "CouchDB setup complete!"
echo "Database: ${CMS_DATABASE}"
echo "URL: ${COUCHDB_URL}/${CMS_DATABASE}"