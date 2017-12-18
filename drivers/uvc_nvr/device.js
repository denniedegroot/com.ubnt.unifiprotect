'use strict';

const Homey = require('homey');

class UvcNvr extends Homey.Device {

    onInit() {
        this._snapshotCount = 0;
        this._apiKey = Homey.ManagerSettings.get('unifi_video_apikey') || '';
        this._data = this.getData();

        new Homey.FlowCardAction('take_snapshot_nvr')
            .register()
            .registerRunListener((args, state) => {
                this.takeSnapshot(args.camera._id, args.width);

                return Promise.resolve(true);
            })
            .getArgument('camera')
            .registerAutocompleteListener((query, args) => {
                return this._cameras;
            });
    }

    onAdded() {
        this._get('sysinfo')
            .then((response) => {
                this._systemInfo = JSON.parse(response).data[0];
                this.log('UVC-NVR version: ' + this._systemInfo.version
                    + ', running on: ' + this._systemInfo.platform);
            });

        this._get('server')
            .then((response) => {
                this._server = JSON.parse(response).data[0];
                this.log('Server name: ' + this._server.name
                    + ', model: ' + this._server.model
                    + ', address: ' + this._server.host);
            });

        this._get('camera')
            .then((response) => {
                this._cameras = JSON.parse(response).data;

                for (let i = 0; i < this._cameras.length; i++) {
                    let camera = this._cameras[i];
                    this.log('Camera name: ' + camera.name
                        + ', model: ' + camera.model
                        + ', address: ' + camera.host);
                }
            });
    }

    takeSnapshot(cameraId, widthInPixels) {
        let params = {
            'force': true
        };

        if (widthInPixels && widthInPixels > 0) {
            params.width = widthInPixels;
        }

        this._get('snapshot/camera/' + cameraId, params)
            .then((imgData) => this._onSnapshot(imgData))
            .catch((error) => console.error(error));
    }

    _onSnapshot(imgData) {
        let jpeg = new Homey.Image('jpg');

        jpeg.setBuffer(imgData);
        jpeg.register()
            .then(() => {
                let token = new Homey.FlowToken('snapshot-' + ++this._snapshotCount, {
                    type: 'image',
                    title: 'Camera snapshot'
                });

                token
                    .register()
                    .then(() => {
                        token.setValue(jpeg)
                            .then(this.log.bind(this, 'token.setValue success'))
                            .catch(this.error.bind(this, 'token.setValue error'));
                    })
                    .catch(this.error.bind(this, 'token.register'));

                new Homey.FlowCardTrigger('snapshot_created')
                    .register()
                    .trigger({
                        'snapshot_token': token
                    })
                    .then(this.log.bind(this, 'snapshot_created.trigger success'))
                    .catch(this.error.bind(this, 'snapshot_created.trigger error'));
            })
            .catch(this.error.bind(this, 'snapshot.register'));
    }

    _get(endpoint, params) {
        let queryString = '?apiKey=' + this._apiKey;

        for (var key in params) {
            let entry = '&' + key + '=' + params[key];
            queryString += entry;
        }

        let url = 'http://' + this._data.ip + ':7080/api/2.0/' + endpoint + queryString;

        return new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? require('https') : require('http');
            const request = lib.get(url, (response) => {
                if (response.statusCode < 200 || response.statusCode > 299) {
                    reject(new Error('Failed to load page, status code: ' + response.statusCode));
                }

                const body = [];

                response.on('data', (chunk) => body.push(chunk));
                response.on('end', () => resolve(body.join('')));
            });
            request.on('error', (err) => reject(err));
        });
    }
}

module.exports = UvcNvr;