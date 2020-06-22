const UserService = require('../UserService');
const axios = require('axios');
const { S3 } = require('aws-sdk');
const config = require('../../../config');
const moment = require('moment');

class ReceiverAdapter {
    async getUrl(url, options={}) {
        const timeout = 10000;
        const source = axios.CancelToken.source();
        options.cancelToken = source.token;
        setTimeout(() => source.cancel("Connection Timeout"), timeout);
        return await axios.create({ timeout }).get(url, options);
    }
    normalizeUrl(url) {
        const normalized = new URL(url);
        if (!normalized.pathname.endsWith('/')) {
            normalized.pathname += '/';
        }
        return normalized
    }
    async matches(baseUrl, key) {
        return false;
    }
    async updateReceiver(receiver) {
        console.info(`updating "${receiver.label}"`);
        const status = await this.getReceiverData(receiver);
        if (receiver.status === 'pending' || receiver.status === 'new') {
            if (status && status.validated) {
                // switch receiver online if validated
                console.info(`"${receiver.label}" has passed verification, setting online`)
                receiver.status = 'online'
            } else {
                receiver.status = 'pending';
            }
        } else {
            if (status) {
                if (status.validated) {
                    receiver.status = 'online';
                } else {
                    // switch back to pending if validation failed
                    console.info(`"${receiver.label}" has failed verifiation, setting pending`)
                    receiver.status = 'pending';
                }
            } else {
                receiver.status = 'offline';
            }
        }
        if (status) {
            this.applyCrawlingResult(receiver, status);
        }

        if (receiver.status == 'online') {
            const ctime = await this.downloadAvatar(receiver, status);
            if (ctime) {
                receiver.avatar_ctime = ctime;
            }
        }

        await receiver.save();
    }
    applyCrawlingResult(receiver, data) {
        receiver.label = data.name;
        receiver.version = data.version;
        let location;
        if (data.location) {
            location = {
                type: 'Point',
                coordinates: data.location
            }
        }
        receiver.location = location;
        receiver.bands = data.bands;
    }
    async getReceiverData(receiver) {
        const status = await this.matches(receiver.url, receiver.key);
        if (status.email) {
            status.validated = status.validated || await this.validateEMail(receiver, status.email);
        }
        return status;
    }
    async validateEMail(receiver, email) {
        const userService = new UserService();
        const user = await userService.getUserDetails(receiver.owner);
        return user.email_verified && user.email === email;
    }
    getAvatarUrl(receiver, status) {
        return false;
    }
    async downloadAvatar(receiver, status) {
        const avatarUrl = this.getAvatarUrl(receiver, status);
        if (!avatarUrl) {
            return
        }

        const headers = {};
        if (receiver.avatar_ctime) {
            headers["If-Modified-Since"] = receiver.avatar_ctime.toUTCString();
        }

        let response
        try {
            response = await this.getUrl(avatarUrl.toString(), {
                responseType: 'stream',
                headers
            });
        } catch (err) {
            if (err.response && err.response.status == 304) {
                // avatar has not been changed
                console.info('received 304: avatar image not changed');
                return;
            }
            console.error('Error while downloading receiver avatar: ', err.stack);
            return;
        }

        const s3 = new S3();
        await s3.upload({
            Bucket: config.avatars.bucket.name,
            Region: config.avatars.bucket.region,
            Body: response.data,
            Key: `${receiver.id}-avatar.png`
        }).promise();

        if (response.headers && response.headers['last-modified']) {
            return moment(response.headers['last-modified']).toDate();
        } else {
            return new Date();
        }
    }
}

module.exports = ReceiverAdapter;