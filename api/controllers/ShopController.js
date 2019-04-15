/**
* ShopController
*
* @description :: Server-side actions for handling incoming requests.
* @help        :: See https://sailsjs.com/docs/concepts/actions
*/

const axios = require('axios');
const shopifyAPI = require('shopify-node-api');
const nonce = require('nonce')();
module.exports = {
  installShop: function(req, res) {
    if (_.isUndefined(req.param('shop')) || req.param('shop') === '') {
      return res.redirect('/');
    }
    req.session.nonce = nonce().toString();
    var Shopify = new shopifyAPI({
      shop: req.param('shop').toLowerCase().replace('https://', '').replace('http://', ''), // MYSHOP.myshopify.com
      ...sails.config.shopifyConfig,
      nonce: req.session.nonce
    });

    var auth_url = Shopify.buildAuthURL();

    // Assuming you are using the express framework
    // you can redirect the user automatically like so
    return res.redirect(auth_url);
  },

  shopInstalled: function(req, res) {
    var Shopify = new shopifyAPI({...sails.config.shopifyConfig, shop: req.param('shop'), nonce: req.session.nonce}), // You need to pass in your config here
    queryParams = req.query;

    Shopify.exchange_temporary_token(queryParams, async function(err, data){
      if (err) {
        return res.serverError(err);
      } else {
        // This will return successful if the request was authentic from Shopify
        // Otherwise err will be non-null.
        // The module will automatically update your config with the new access token
        // It is also available here as data['access_token']
        req.session.isAppInstalled = true;
        req.session.shop = queryParams.shop;
        req.session.queryParams = queryParams;
        req.session.token = data['access_token'];
        await Shop.updateOrCreate({shopifyDomain: req.session.shop}, {shopifyDomain: req.session.shop, token: req.session.token});
        axios({
          headers: {
            'X-Shopify-Access-Token': req.session.token,
            'Content-Type': 'application/json'
          },
          method: 'get',
          url: req.param('shop').toLowerCase().startsWith('http')? (req.param('shop').toLowerCase().startsWith('https')? req.param('shop') : req.param('shop').replace('http', 'https'))  : 'https://' + req.param('shop') + '/admin/recurring_application_charges.json', //Returns a link that starts with https
        }).then(async function(response) {
          const installedShop = await Shop.findOne({shopifyDomain: req.session.shop}).populate('subscriptions');

          var found = false;
          if(installedShop.subscriptions) {
            found = installedShop.subscriptions.find(async function(element) {
              let foundElm = response.data.recurring_application_charges.find(function(subscription) {
                return subscription.status === "active" && subscription.id == element.shopifyId;
              });
              return element.shopifyId == foundElm.id;
            });
          }

          let skipPayment = found? true : false;

          if (installedShop && skipPayment) {
            req.session.isPayed = true;
            return res.view("pages/app", {queryParams: req.session.queryParams});
          } else {
            axios({
              headers: {
                'X-Shopify-Access-Token': req.session.token,
                'Content-Type': 'application/json'
              },
              method: 'post',
              url: req.param('shop').toLowerCase().startsWith('http')? (req.param('shop').toLowerCase().startsWith('https')? req.param('shop') : req.param('shop').replace('http', 'https'))  : 'https://' + req.param('shop') + '/admin/recurring_application_charges.json', //Returns a link that starts with https

              data: {
                "recurring_application_charge": {
                  "name": "Recurring charge",
                  "price": sails.config.shopifyPayment.price,
                  "return_url": sails.config.shopifyPayment.returnUrl,
                  'test': sails.config.shopifyPayment.test,
                  'trial_days': sails.config.shopifyPayment.trialDays
                }
              }
            })
            .then(async function (response) {
              req.session.paymentInformation = response.data;
              return res.redirect(response.data.recurring_application_charge.confirmation_url);
            })
            .catch(function (error) {
              return res.negotiate(error);
            });
          }
        }).catch(function(error) {
          return res.negotiate(error);
        });
      }
    });
  },

  isAppInstalled: function(req, res) {
    return req.session.isAppInstalled? res.ok() : res.forbidden();
  },

  paymentAccepted: function(req, res) {
    if (_.isUndefined(req.param('charge_id'))) {
      return res.redirect('/');
    }
    req.session.paymentInformation.recurring_application_charge.status = 'active';
    axios({
      headers: {
        'X-Shopify-Access-Token': req.session.token,
        'Content-Type': 'application/json'
      },
      method: 'post',
      url: 'https://' + req.session.shop + '/admin/recurring_application_charges/' + req.param('charge_id') + '/activate.json',
      data: req.session.paymentInformation
    })
    .then(async function (response) {
      const resp = response.data.recurring_application_charge;
      const shopId = await Shop.findOne({shopifyDomain: req.session.shop});

      await Subscription.updateOrCreate({shopifyId: resp.id}, {shopifyId: resp.id, price: resp.price, active: (resp.status === 'active'? true : false), test: (resp.test? true : false), shop: shopId.id});
      req.session.isPayed = true;
      return res.view("pages/app", {queryParams: req.session.queryParams});
    })
    .catch(function (error) {
      return res.negotiate(error);
    });
  }

};
