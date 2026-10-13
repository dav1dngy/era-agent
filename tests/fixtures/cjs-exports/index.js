// Fixture for CommonJS export inference: renamed, shorthand and quoted keys.
const internal = () => 1;
const short = 2;
const other = 3;
module.exports = { publicName: internal, short, 'quoted-key': other };
