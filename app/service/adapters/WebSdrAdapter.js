const ReceiverAdapter = require('./ReceiverAdapter');
const Maidenhead = require('maidenhead');
const { JSDOM } = require('jsdom');

class WebSdrAdapter extends ReceiverAdapter {
    async matches(baseUrl, claims) {
        const normalized = this.normalizeUrl(baseUrl);

        const calls = [
            this.getStatus(normalized)
        ]
        if (claims) {
            calls.push(this.getAuth(normalized, claims));
        }
        try {
            const [status, auth] = await Promise.all(calls);
            status.validated = auth;
            return status
        } catch (err) {
            console.error('Error detecting Websdr receiver: ', err.stack || err.message);
        }

        return false;
    }
    async getStatus(normalized) {
        const statusUrl = new URL(normalized);
        statusUrl.pathname += '~~orgstatus';
        const statusResponse = await this.getUrl(statusUrl.toString())
        const parsed = this.parseResponse(statusResponse.data);
        let location;
        if ('Qth' in parsed) {
            location = this.parseLocator(parsed['Qth'])
        }
        let email;
        if ('Email' in parsed) {
            email = this.parseEmail(parsed['Email'])
        }
        return {
            name: parsed['Description'],
            location,
            email,
            bands: parsed['Bands']
        }
    }
    async getAuth(normalized, claims) {
        const response = await this.getUrl(normalized.toString());
        const dom = new JSDOM(response.data);
        const tags = dom.window.document.querySelectorAll('meta[name=receiverbook-confirmation]');
        return Object.fromEntries(claims.map(claim => {
            return [
                claim.id,
                tags && Array.prototype.some.call(tags, tag => tag.content === claim.key)
            ];
        }));
    }
    parseResponse(response) {
        const parsed = response.split('\n').map((line) => {
            const items = line.split(': ');
            return [items[0], items.slice(1).join(': ')];
        });

        const bands = parsed.filter(b => b[0] === 'Band').map(this.parseBand);

        const composed = Object.fromEntries(parsed.filter(b => b[0] !== 'Band'))
        composed.Bands = bands;
        return composed;
    }
    parseLocator(locatorString) {
        const locator = new Maidenhead();
        locator.locator = locatorString;
        if (locator.lat && locator.lon) {
            // longitude first!!
            return [locator.lon, locator.lat];
        }
        return false;
    }
    parseBand(bandInfo) {
        const [_, bandString] = bandInfo;
        const elements = bandString.split(' ');
        return {
            center_freq: parseFloat(elements[1]) * 1E3,
            sample_rate: parseFloat(elements[2]) * 1E3,
            name: elements.slice(3).join(' '),
            type: 'centered'
        }
    }
    parseEmail(inputString) {
        if (inputString.indexOf('@') >= 0) {
            return inputString;
        }
        const chars = Buffer.from(inputString, 'utf-8').map(i => i ^ 1);
        return chars.toString('utf-8');
    }
}

module.exports = WebSdrAdapter;