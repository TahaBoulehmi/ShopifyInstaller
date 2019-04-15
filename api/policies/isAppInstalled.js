/**
* is-app-installed
*
* A simple policy that blocks requests from non installed shops
*
* For more about how to use policies, see:
*   https://sailsjs.com/config/policies
*   https://sailsjs.com/docs/concepts/policies
*   https://sailsjs.com/docs/concepts/policies/access-control-and-permissions
*/
module.exports = function (req, res, proceed) {
  return (req.session && req.session.isAppInstalled)? proceed() : res.forbidden();
};
