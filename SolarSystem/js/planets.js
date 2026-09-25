// Planet data. `size` and `orbit` are display units, not real scale — the real
// solar system is 99.9% empty space and would render as a black screen with a
// few invisible dots. Both are compressed with a power curve so the ordering
// and the rough feel of the spacing survive. Everything under `facts` is real.

// Compression curves, kept here so the numbers below stay readable.
const displaySize = (earthRadii) => 0.9 * Math.pow(earthRadii, 0.62);
const displayOrbit = (au) => 20 + Math.pow(au, 0.55) * 22;

export const SUN = {
  name: 'Sun',
  size: 10,
  spin: 0.02,
  facts: {
    Type: 'G2V star',
    Diameter: '1,391,400 km',
    Mass: '333,000 Earths',
    Surface: '5,505 °C',
    Age: '4.6 billion yr',
  },
  fact: 'Holds 99.86% of all the mass in the solar system.',
};

export const PLANETS = [
  {
    name: 'Mercury',
    size: displaySize(0.383),
    orbit: displayOrbit(0.387),
    periodDays: 87.97,
    rotationHours: 1407.6,
    tilt: 0.03,
    eccentricity: 0.206,
    texture: { kind: 'rocky', base: '#8c8279', shades: ['#6b6058', '#a89c8e', '#5b524b'], craters: 220, seed: 11 },
    facts: {
      Diameter: '4,879 km',
      'From Sun': '57.9 M km',
      Year: '88 Earth days',
      Day: '58.6 Earth days',
      Moons: '0',
    },
    fact: 'A day on Mercury lasts two thirds of its year.',
  },
  {
    name: 'Venus',
    size: displaySize(0.949),
    orbit: displayOrbit(0.723),
    periodDays: 224.7,
    rotationHours: -5832.5, // negative: Venus rotates backwards
    tilt: 177.4,
    eccentricity: 0.007,
    texture: { kind: 'gas', palette: ['#c9a227', '#e6c96a', '#f2dfa8', '#d8b455', '#bf8f2e'], seed: 23 },
    facts: {
      Diameter: '12,104 km',
      'From Sun': '108.2 M km',
      Year: '225 Earth days',
      Day: '243 Earth days',
      Moons: '0',
    },
    fact: 'Hottest planet in the solar system — 465 °C, hotter than Mercury.',
  },
  {
    name: 'Earth',
    size: displaySize(1),
    orbit: displayOrbit(1),
    periodDays: 365.26,
    rotationHours: 23.93,
    tilt: 23.44,
    eccentricity: 0.017,
    texture: { kind: 'earth' },
    moons: [{ name: 'Moon', size: 0.25, orbit: 2.4, periodDays: 27.3, seed: 41 }],
    facts: {
      Diameter: '12,756 km',
      'From Sun': '149.6 M km',
      Year: '365.26 days',
      Day: '23h 56m',
      Moons: '1',
    },
    fact: 'The only place in the universe known to have you on it.',
  },
  {
    name: 'Mars',
    size: displaySize(0.532),
    orbit: displayOrbit(1.524),
    periodDays: 686.98,
    rotationHours: 24.62,
    tilt: 25.19,
    eccentricity: 0.093,
    texture: { kind: 'rocky', base: '#a4552f', shades: ['#7e3b1f', '#c9764a', '#e0a878'], craters: 160, seed: 31 },
    facts: {
      Diameter: '6,792 km',
      'From Sun': '227.9 M km',
      Year: '687 Earth days',
      Day: '24h 37m',
      Moons: '2',
    },
    fact: 'Olympus Mons is 22 km tall — nearly three Everests.',
  },
  {
    name: 'Jupiter',
    size: displaySize(11.21),
    orbit: displayOrbit(5.203),
    periodDays: 4332.6,
    rotationHours: 9.93,
    tilt: 3.13,
    eccentricity: 0.049,
    texture: {
      kind: 'gas',
      palette: ['#8c6239', '#c19a6b', '#e8d5b7', '#d9b382', '#a87848', '#f0e3cc'],
      seed: 53,
      storms: [{ x: 0.3, y: 0.63, r: 0.055, color: 'rgba(190,80,50,0.9)' }],
    },
    facts: {
      Diameter: '142,984 km',
      'From Sun': '778.5 M km',
      Year: '11.9 Earth years',
      Day: '9h 56m',
      Moons: '95',
    },
    fact: 'The Great Red Spot is a storm that has raged for 350+ years.',
  },
  {
    name: 'Saturn',
    size: displaySize(9.45),
    orbit: displayOrbit(9.537),
    periodDays: 10759,
    rotationHours: 10.66,
    tilt: 26.73,
    eccentricity: 0.052,
    texture: { kind: 'gas', palette: ['#c4a068', '#e3cb96', '#f5e7c4', '#d4b57e', '#b08f55'], seed: 67 },
    ring: { inner: 1.35, outer: 2.45 },
    facts: {
      Diameter: '120,536 km',
      'From Sun': '1.43 B km',
      Year: '29.4 Earth years',
      Day: '10h 42m',
      Moons: '146',
    },
    fact: 'Less dense than water — drop it in an ocean and it would float.',
  },
  {
    name: 'Uranus',
    size: displaySize(4.007),
    orbit: displayOrbit(19.19),
    periodDays: 30687,
    rotationHours: -17.24,
    tilt: 97.77, // tipped on its side
    eccentricity: 0.047,
    texture: { kind: 'gas', palette: ['#8fd6dd', '#b8e8ec', '#d5f2f4', '#a3dfe4'], seed: 79 },
    ring: { inner: 1.6, outer: 2.0, opacity: 0.28, tiltWithPlanet: true },
    facts: {
      Diameter: '51,118 km',
      'From Sun': '2.87 B km',
      Year: '84 Earth years',
      Day: '17h 14m',
      Moons: '28',
    },
    fact: 'Rolls around the Sun on its side, likely knocked over by an impact.',
  },
  {
    name: 'Neptune',
    size: displaySize(3.883),
    orbit: displayOrbit(30.07),
    periodDays: 60190,
    rotationHours: 16.11,
    tilt: 28.32,
    eccentricity: 0.01,
    texture: {
      kind: 'gas',
      palette: ['#2a4fa8', '#3f6fd1', '#6a97e8', '#4a7cd4', '#1e3c85'],
      seed: 97,
      storms: [{ x: 0.66, y: 0.42, r: 0.045, color: 'rgba(15,28,70,0.9)' }],
    },
    facts: {
      Diameter: '49,528 km',
      'From Sun': '4.50 B km',
      Year: '165 Earth years',
      Day: '16h 06m',
      Moons: '16',
    },
    fact: 'Winds reach 2,100 km/h — the fastest in the solar system.',
  },
];

// Orbital inclination to the ecliptic, in degrees. Small values, but enough to
// stop the system reading as a perfectly flat disc when you orbit the camera.
export const INCLINATION = {
  Mercury: 7.0,
  Venus: 3.39,
  Earth: 0,
  Mars: 1.85,
  Jupiter: 1.3,
  Saturn: 2.49,
  Uranus: 0.77,
  Neptune: 1.77,
};
