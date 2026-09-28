import { ValidateBy, ValidationOptions, buildMessage } from 'class-validator';

// ISO 3166-1 country codes the app knows (same list as the frontend pickers,
// quscer-hrm-frontend/src/lib/geo-data.json).
export const COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST",
  "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR",
  "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN",
  "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
];

const COUNTRIES = new Set(COUNTRY_CODES);

export function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsCountryCode(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isCountryCode',
      validator: {
        validate: (v) => typeof v === 'string' && COUNTRIES.has(v),
        defaultMessage: buildMessage((each) => `${each}$property must be a country code such as PK or AE`, options),
      },
    },
    options,
  );
}

// Province / state codes are short letters or digits ("PB", "ICT", "01").
export function IsRegionCode(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isRegionCode',
      validator: {
        validate: (v) => typeof v === 'string' && /^[A-Z0-9]{1,10}$/.test(v),
        defaultMessage: buildMessage((each) => `${each}$property must be a province / state code such as PB`, options),
      },
    },
    options,
  );
}

export function IsTimeZone(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isTimeZone',
      validator: {
        validate: isTimeZone,
        defaultMessage: buildMessage((each) => `${each}$property must be a time zone such as Asia/Karachi`, options),
      },
    },
    options,
  );
}
