import {
  ascending,
  extent,
  interpolateHcl,
  interpolateHsl,
  interpolateLab,
  interpolateNumber,
  interpolateRgb,
  interpolateRound,
  min,
  max,
  median,
  quantile,
  quantize,
  reverse as reverseof,
  pairs,
  scaleLinear,
  scaleLog,
  scalePow,
  scaleQuantile,
  scaleSymlog,
  scaleThreshold,
  scaleIdentity
} from "d3";
import {positive, negative, finite} from "../defined.js";
import {constant, order} from "../options.js";
import {ordinalRange, quantitativeScheme} from "./schemes.js";
import {registry, radius, opacity, color, length} from "./index.js";

export const flip = i => t => i(1 - t);
const unit = [0, 1];

const interpolators = new Map([
  // numbers
  ["number", interpolateNumber],

  // color spaces
  ["rgb", interpolateRgb],
  ["hsl", interpolateHsl],
  ["hcl", interpolateHcl],
  ["lab", interpolateLab]
]);

export function Interpolator(interpolate) {
  const i = `${interpolate}`.toLowerCase();
  if (!interpolators.has(i)) throw new Error(`unknown interpolator: ${i}`);
  return interpolators.get(i);
}

export function ScaleQ(key, scale, channels, {
  type,
  nice,
  clamp,
  zero,
  domain = (registry.get(key) === radius || registry.get(key) === opacity || registry.get(key) === length ? inferZeroDomain : inferDomain)(channels),
  unknown,
  round,
  scheme,
  range = registry.get(key) === radius ? inferRadialRange(channels, domain) : registry.get(key) === length ? inferLengthRange(channels, domain) : registry.get(key) === opacity ? unit : undefined,
  interpolate = registry.get(key) === color ? (scheme == null && range !== undefined ? interpolateRgb : quantitativeScheme(scheme !== undefined ? scheme : type === "cyclical" ? "rainbow" : "turbo")) : round ? interpolateRound : interpolateNumber,
  reverse
}) {
  if (type === "cyclical" || type === "sequential") type = "linear"; // shorthand for color schemes
  reverse = !!reverse;

  // Sometimes interpolate is a named interpolator, such as "lab" for Lab color
  // space. Other times interpolate is a function that takes two arguments and
  // is used in conjunction with the range. And other times the interpolate
  // function is a “fixed” interpolator on the [0, 1] interval, as when a
  // color scheme such as interpolateRdBu is used.
  if (typeof interpolate !== "function") {
    interpolate = Interpolator(interpolate);
  }
  if (interpolate.length === 1) {
    if (reverse) {
      interpolate = flip(interpolate);
      reverse = false;
    }
    if (range === undefined) {
      range = Float64Array.from(domain, (_, i) => i / (domain.length - 1));
      if (range.length === 2) range = unit; // optimize common case of [0, 1]
    }
    scale.interpolate((range === unit ? constant : interpolatePiecewise)(interpolate));
  } else {
    scale.interpolate(interpolate);
  }

  // If a zero option is specified, we assume that the domain is numeric, and we
  // want to ensure that the domain crosses zero. However, note that the domain
  // may be reversed (descending) so we shouldn’t assume that the first value is
  // smaller than the last; and also it’s possible that the domain has more than
  // two values for a “poly” scale. And lastly be careful not to mutate input!
  if (zero) {
    const [min, max] = extent(domain);
    if ((min > 0) || (max < 0)) {
      domain = Array.from(domain);
      if (order(domain) < 0) domain[domain.length - 1] = 0;
      else domain[0] = 0;
    }
  }

  if (reverse) domain = reverseof(domain);
  scale.domain(domain).unknown(unknown);
  if (nice) scale.nice(nice === true ? undefined : nice), domain = scale.domain();
  if (range !== undefined) scale.range(range);
  if (clamp) scale.clamp(clamp);
  return {type, domain, range, scale, interpolate};
}

export function ScaleLinear(key, channels, options) {
  return ScaleQ(key, scaleLinear(), channels, options);
}

export function ScaleSqrt(key, channels, options) {
  return ScalePow(key, channels, {...options, exponent: 0.5});
}

export function ScalePow(key, channels, {exponent = 1, ...options}) {
  return ScaleQ(key, scalePow().exponent(exponent), channels, {...options, type: "pow"});
}

export function ScaleLog(key, channels, {base = 10, domain = inferLogDomain(channels), ...options}) {
  return ScaleQ(key, scaleLog().base(base), channels, {...options, domain});
}

export function ScaleQuantile(key, channels, {
  quantiles = 5,
  scheme = "rdylbu",
  domain = inferQuantileDomain(channels),
  interpolate,
  range = interpolate !== undefined ? quantize(interpolate, quantiles) : registry.get(key) === color ? ordinalRange(scheme, quantiles) : undefined,
  reverse
}) {
  return ScaleThreshold(key, channels, {
    domain: scaleQuantile(domain, range === undefined ? {length: quantiles} : range).quantiles(),
    range,
    reverse
  });
}

export function ScaleSymlog(key, channels, {constant = 1, ...options}) {
  return ScaleQ(key, scaleSymlog().constant(constant), channels, options);
}

export function ScaleThreshold(key, channels, {
  domain = [0], // explicit thresholds in ascending order
  unknown,
  scheme = "rdylbu",
  interpolate,
  range = interpolate !== undefined ? quantize(interpolate, domain.length + 1) : registry.get(key) === color ? ordinalRange(scheme, domain.length + 1) : undefined,
  reverse
}) {
  if (!pairs(domain).every(([a, b]) => ascending(a, b) <= 0)) throw new Error("non-ascending domain");
  if (reverse) range = reverseof(range); // domain ascending, so reverse range
  return {type: "threshold", scale: scaleThreshold(domain, range === undefined ? [] : range).unknown(unknown), domain, range};
}

export function ScaleIdentity() {
  return {type: "identity", scale: scaleIdentity()};
}

export function inferDomain(channels, f = finite) {
  return channels.length ? [
    min(channels, ({value}) => value === undefined ? value : min(value, f)),
    max(channels, ({value}) => value === undefined ? value : max(value, f))
  ] : [0, 1];
}

function inferZeroDomain(channels) {
  return [0, channels.length ? max(channels, ({value}) => value === undefined ? value : max(value, finite)) : 1];
}

// We don’t want the upper bound of the radial domain to be zero, as this would
// be degenerate, so we ignore nonpositive values. We also don’t want the maximum
// default radius to exceed 30px.
function inferRadialRange(channels, domain) {
  const h25 = quantile(channels, 0.5, ({value}) => value === undefined ? NaN : quantile(value, 0.25, positive));
  const range = domain.map(d => 3 * Math.sqrt(d / h25));
  const k = 30 / max(range);
  return k < 1 ? range.map(r => r * k) : range;
}

// We want a length scale’s domain to go from zero to a positive value, and to
// treat negative lengths if any as inverted vectors of equivalent magnitude. We
// also don’t want the maximum default length to exceed 60px.
function inferLengthRange(channels, domain) {
  const h50 = median(channels, ({value}) => value === undefined ? NaN : median(value, Math.abs));
  const range = domain.map(d => 12 * d / h50);
  const k = 60 / max(range);
  return k < 1 ? range.map(r => r * k) : range;
}

function inferLogDomain(channels) {
  for (const {value} of channels) {
    if (value !== undefined) {
      for (let v of value) {
        v = +v;
        if (v > 0) return inferDomain(channels, positive);
        if (v < 0) return inferDomain(channels, negative);
      }
    }
  }
  return [1, 10];
}

function inferQuantileDomain(channels) {
  const domain = [];
  for (const {value} of channels) {
    if (value === undefined) continue;
    for (const v of value) domain.push(v);
  }
  return domain;
}

export function interpolatePiecewise(interpolate) {
  return (i, j) => t => interpolate(i + t * (j - i));
}
