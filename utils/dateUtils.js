const WEEK_ENDING_DOW = 5; // Friday

function toISODate(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return x.toISOString().slice(0, 10);
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayName(d) {
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}

function computeWeekDays(weekEndingISO) {
  const we = parseISODate(weekEndingISO);
  const start = new Date(we);
  start.setDate(we.getDate() - 6);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ workDate: toISODate(d), dayName: dayName(d) });
  }
  return days;
}

module.exports = { WEEK_ENDING_DOW, computeWeekDays };
