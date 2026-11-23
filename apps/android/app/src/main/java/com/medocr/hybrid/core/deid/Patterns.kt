// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

/** Kotlin mirror of packages/parsing/src/deid/patterns.ts. */

val PLACEHOLDER_TOKEN = Regex("\\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\\]")

val NAME_STOP_WORDS: Set<String> = setOf(
    "age", "sex", "gender", "dob", "d.o.b", "d.o.b.", "date", "dated",
    "phone", "ph", "ph.", "mob", "mob.", "mobile", "tel", "tel.", "telephone",
    "email", "e-mail", "abha", "aadhaar", "aadhar", "address", "addr", "pin", "pincode",
    "uhid", "mrn", "reg", "reg.", "registration",
    "male", "female", "m", "f", "yrs", "yr", "years", "year", "y",
    "mbbs", "md", "ms", "dm", "dnb", "frcs", "frcp", "bds", "mds", "bams", "bhms",
    "ip", "op",
)

val CLINICAL_AFTER_NAME = Regex(
    "\\d+\\s*(?:mg|mcg|ug|µg|g|gm|ml|iu|i\\.u\\.|units?|%|meq|mmol|mcg|tab|cap|syp)|(?:\\b(?:tab|cap|syp|syrup|inj|injection|tablet|capsule|drops?|suspension|ointment|cream)\\b)",
    RegexOption.IGNORE_CASE,
)

val ORG_SUFFIX = Regex(
    "^(?:['’]s)?\\s+(?:laborator(?:y|ies)|labs?|ltd\\.?|pvt\\.?|private|limited|pharma\\b|pharmaceuticals?|hospital|clinic|nursing|medical\\s+(?:college|centre|center|institute)|diagnostic|healthcare|health\\s*care)\\b",
    RegexOption.IGNORE_CASE,
)

val ADDRESS_KEYWORDS = Regex(
    "\\b(?:street|st\\.|road|rd\\.|marg|nagar|lane|cross|block|sector|phase|flat|apartment|apartments|apt\\.?|house\\s*no\\.?|h\\.?\\s*no\\.?|door\\s*no\\.?|plot\\s*no\\.?|villa|colony|layout|enclave|extension|society|village|vill\\.|p\\.?\\s*o\\.?|post\\s*office|tehsil|taluk|taluka|district|dist\\.|opp\\.|opposite|near|behind|chowk|ganj|bhavan|niwas|floor|wing|premises|township|pg\\b|residency|apartment|appt)\\b",
    RegexOption.IGNORE_CASE,
)

val CITY_NAMES: Set<String> = setOf(
    "delhi", "new delhi", "mumbai", "bombay", "kolkata", "calcutta", "chennai", "madras",
    "bengaluru", "bangalore", "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "surat",
    "kochi", "cochin", "nagpur", "indore", "bhopal", "patna", "bhubaneswar", "chandigarh",
    "gurgaon", "gurugram", "noida", "ghaziabad", "thane", "navi mumbai", "visakhapatnam",
    "vijayawada", "coimbatore", "madurai", "vadodara", "rajkot", "nashik", "kanpur", "ranchi",
    "guwahati", "trivandrum", "thiruvananthapuram", "mysore", "mysuru", "varanasi", "allahabad",
    "prayagraj", "amritsar", "ludhiana", "jodhpur", "raipur", "dehradun", "shimla", "panaji",
    "goa", "srinagar", "jammu", "pondicherry", "puducherry", "faridabad", "howrah", "secunderabad",
    "warangal", "tirupati", "mangalore", "mangaluru", "hubli", "belgaum", "aurangabad", "solapur",
    "kolhapur", "agra", "meerut",
)

val LINE_START_CLINICAL = Regex(
    "^(?:tab(?:let)?|cap(?:sule)?|syp|syrup|inj(?:ection)?|rx|dose|frequency|duration|investigation|hemoglobin|haemoglobin|wbc|rbc|platelet|hba1c|creatinine|glucose|tsh|fbs|ppbs|rbs|urea|bilirubin|cholesterol|triglyceride|sgot|sgpt|alt|ast|sodium|potassium|chloride)\\b",
    RegexOption.IGNORE_CASE,
)

val NEW_SECTION_LABEL = Regex(
    "^(?:age|sex|gender|dob|d\\.o\\.b|date|dated|phone|ph\\.?|mob(?:ile)?|tel(?:ephone)?|email|e-mail|abha|aadhaar|aadhar|patient|pt\\.?|doctor|dr\\.?|rx|diagnosis|advice|history|chief|investigation|test|uhid|mrn|reg(?:istration)?|ref(?:erred)?|weight|height|bp|pulse|temp)\\b",
    RegexOption.IGNORE_CASE,
)
