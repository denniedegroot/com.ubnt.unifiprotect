// eslint-disable-next-line node/no-unpublished-require,strict
const Homey = require('homey');
const UfPapi = require('./lib/ufpapi');
const UfvConstants = require('./lib/ufvconstants');
const ManagerApi = Homey.ManagerApi;
const Settings = Homey.ManagerSettings;

class UniFiProtect extends Homey.App {
  async onInit() {
    this.loggedIn = false;
    this.nvrIp = false;
    this.nvrUsername = false;
    this.nvrPassword = false;

    // Register snapshot image token
    this.snapshotToken = new Homey.FlowToken('ufv_snapshot', {
      type: 'image',
      title: 'Snapshot',
    });
    Homey.ManagerFlow.registerToken(this.snapshotToken);

    // Single API instance for all devices
    this.api = new UfPapi();

    // Enable remote debugging, if applicable
    if (Homey.env.DEBUG === 'true') {
      // eslint-disable-next-line global-require
      require('inspector')
        .open(9229, '0.0.0.0');
    }

    // Subscribe to credentials updates
    Homey.ManagerSettings.on('set', key => {
      if (key === 'ufp:credentials') {
        this._login();
      }
    });
    this._login();

    // this._checkMotion();
    this._refreshCapabilities();

    // wait for bootstrap and start websocket
    this._waitForBootstrap();

    this.debug('UniFi Protect is running.');
  }

  _login() {
    this.debug('Logging in...');

    // Validate NVR IP address
    const nvrip = Homey.ManagerSettings.get('ufp:nvrip');
    if (!nvrip) {
      this.debug('NVR IP address not set.');
      return;
    }

    // Setting NVR Port when set
    const nvrport = Homey.ManagerSettings.get('ufp:nvrport');
    if (nvrport) {
      this.api.setApiPort(nvrport);
    }

    // Validate NVR credentials
    const credentials = Homey.ManagerSettings.get('ufp:credentials');
    if (!credentials) {
      this.debug('Credentials not set.');
      return;
    }

    this.api.setApiPort(443);
    // Log in to NVR
    this.api.loginProxy(nvrip, credentials.username, credentials.password)
      .then(() => {
        this.api.getBootstrapInfo()
          .then(() => {
            this.debug('Bootstrap loaded.');
            this.loggedIn = true;
            this.nvrIp = nvrip;
            this.nvrUsername = credentials.username;
            this.nvrPassword = credentials.password;
          })
          .catch(error => this.error(error));
        // _refreshCookie after 45 minutes
        const timeOutFunction = function () {
          this._refreshCookie();
        }.bind(this);
        setTimeout(timeOutFunction, 2700000);
        this.debug('Logged in.');
      })
      .catch(error => this.error(error));
  }

  _checkMotion() {
    if (this.loggedIn) {
      // Get Last Motion
      this.api.getMotionEvents()
        .then(motions => {
          motions.forEach(motion => {
            Homey.ManagerDrivers.getDriver('protectcamera')
              .onParseTriggerMotionData(motion.camera, motion.start, motion.end, motion.thumbnail, motion.heatmap, motion.score);
          });
        })
        .catch(error => this.error(error));
    }
    // _checkMotion after 1 second
    const timeOutFunction = function () {
      this._checkMotion();
    }.bind(this);
    setTimeout(timeOutFunction, 1000);
  }

  _refreshCapabilities() {
    if (this.loggedIn) {
      this.api.getMotionEvents()
        .then(events => {
          this.api.getCameras()
            .then(cameras => {
              cameras.forEach(camera => {
                Homey.ManagerDrivers.getDriver('protectcamera')
                  .onParseTriggerCameraData(camera);

                for (let event of events) {
                  if (event.camera !== camera.id) continue;
                  Homey.ManagerDrivers.getDriver('protectcamera')
                    .onParseTriggerCameraEvents(event);
                  break;

                }


              });
            })
            .catch(error => this.error(error));

        })
        .catch(error => this.error(error));
    }
    // memory collect every 5 seconds, where is the memory leak?
    if (global.gc) {
      global.gc();
    } else {
      this.warn('Can\'t find GC hook.....');
    }
    // _refreshCapabilities after 5 second
    const timeOutFunction = function () {
      this._refreshCapabilities();
    }.bind(this);
    setTimeout(timeOutFunction, 5000);
  }

  _refreshCookie() {
    if (this.loggedIn) {
      this.api._lastUpdateId = null;
      this.api.loginProxy(this.nvrIp, this.nvrUsername, this.nvrPassword)
        .then(() => {
          this.debug('Logged in again to refresh cookie.');
          this.api.getBootstrapInfo()
            .then(() => {
              this.log('Bootstrap loaded.');
              this.loggedIn = true;

              Homey.app.debug('Calling reconnectUpdatesListener');
              Homey.app.api.ws.reconnectUpdatesListener();
            })
            .catch(error => this.error(error));
        })
        .catch(error => this.error(error));
    }

    // _refreshCookie after 45 minutes
    const timeOutFunction = function () {
      this._refreshCookie();
    }.bind(this);
    setTimeout(timeOutFunction, 2700000);
  }

  _waitForBootstrap() {
    if (typeof Homey.app.api._lastUpdateId !== 'undefined' && Homey.app.api._lastUpdateId !== null) {
      Homey.app.debug('Called waitForBootstrap');
      Homey.app.api.ws.launchUpdatesListener();
      Homey.app.api.ws.configureUpdatesListener();
    } else {
      Homey.app.debug('Calling waitForBootstrap');
      setTimeout(this._waitForBootstrap.bind(this), 250);
    }
  }


  debug(message) {
    if (Homey.env.DEBUG === 'true') {
      Homey.app.log(message);
    }

    ManagerApi.realtime(UfvConstants.EVENT_SETTINGS_DEBUG, message);
  }

}

// 2700000
// 300000

module.exports = UniFiProtect;
