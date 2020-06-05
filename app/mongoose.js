const mongoose = require('mongoose');
const config = require('../config');
const url = require('url');
require('./models');

module.exports.setup = async () => {
    const mongoUrl = new URL(config.mongo.url);
    mongoUrl.username = config.mongo.user;
    mongoUrl.password = config.mongo.password;
    await mongoose.connect(mongoUrl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    return mongoose
}