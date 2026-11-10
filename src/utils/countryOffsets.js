/**
 * UTC offset (whole hours) per supported country, used by autoGreetingScheduler
 * to convert a fixed local-time greeting schedule (06:00/13:00/18:00/22:00) into
 * the correct UTC hour to fire at. Add more countries here as needed - single
 * timezone countries only; multi-timezone countries would need a per-group
 * region instead of a country, so aren't included here.
 */
const COUNTRY_OFFSETS = {
  nigeria: 1,
  ghana: 0,
};

module.exports = { COUNTRY_OFFSETS };