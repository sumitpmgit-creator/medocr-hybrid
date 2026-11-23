// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core.deid

/**
 * Kotlin mirror of packages/parsing/src/deid/indian-names.ts.
 * Seed lists of common Indian given names and surnames, used as a
 * conservative cue for unlabelled free-text names (e.g. "sunita devi").
 * This is a seed, not an exhaustive gazetteer: names outside the list
 * will be missed unless a label, honorific, or relation cue is present.
 *
 * Drug and lab names are deliberately absent. Do not add short tokens
 * that collide with clinical text (e.g. "pan", "soma", "tab").
 */

val INDIAN_GIVEN_NAMES: Set<String> = setOf(
"aamir", "aarti", "aditi", "ajay", "amit", "ananya", "anil", "anita",
    "anjali", "arti", "arun", "aruna", "asha", "ashok", "bhavna", "chitra",
    "deepa", "deepak", "dinesh", "divya", "farhan", "farida", "fatima", "gaurav",
    "geeta", "girish", "gita", "harish", "harsh", "imran", "iqbal", "irfan",
    "isha", "jamal", "javed", "jaya", "kalpana", "kamala", "kavita", "kavya",
    "kiran", "lakshmi", "lalit", "lalita", "lata", "leela", "madhavi", "madhu",
    "mahesh", "mallika", "manisha", "manoj", "meena", "meera", "mehul", "mohammed",
    "mohan", "mohd", "mohini", "muhammad", "mukesh", "nandan", "nandini", "narasimha",
    "naresh", "naseem", "nasir", "neelam", "neha", "nirmala", "nisha", "omkar",
    "pankaj", "parveen", "pawan", "pooja", "poonam", "pradeep", "prakash", "pramod",
    "praveen", "preeti", "prema", "priya", "priyanka", "radha", "radhika", "rahul",
    "rajan", "rajani", "rajesh", "raju", "rakesh", "ramesh", "rani", "rashmi",
    "ravi", "reema", "rekha", "renuka", "ritu", "riya", "rohit", "roshan",
    "sachin", "sadhana", "sagar", "sakshi", "saleem", "salma", "salman", "sameer",
    "samir", "sandeep", "sangeeta", "sanjay", "santosh", "sapna", "sarita", "satish",
    "savita", "seema", "shabana", "shahid", "shalini", "shamim", "shankar", "sharad",
    "sharif", "sheela", "shilpa", "shobha", "shravan", "shruti", "shweta", "siddharth",
    "simran", "sita", "sneha", "sohail", "sonal", "srinivas", "subhash", "subramanian",
    "sucheta", "sudha", "sudhir", "sujata", "suman", "sumitra", "sunanda", "sunil",
    "sunita", "suraj", "suresh", "surinder", "sushma", "swati", "tanveer", "tanvi",
    "tarun", "tejinder", "uma", "umesh", "urmil", "usha", "varun", "veena",
    "venkata", "vidya", "vijay", "vijaya", "vikas", "vikram", "vinay", "vinod",
    "virender", "vishal", "waheeda", "yash", "yasmin", "zahir", "zainab", "zoya",
)

val INDIAN_SURNAMES: Set<String> = setOf(
"agarwal", "agrawal", "ahmad", "ahmed", "ali", "ansari", "arora", "baig",
    "banerjee", "bansal", "begum", "bhat", "bhatt", "bibi", "burman", "chakraborty",
    "chand", "chatterjee", "chauhan", "chopra", "choudhary", "dar", "das", "desai",
    "devi", "dutt", "dutta", "gandhi", "ghosh", "goswami", "gowda", "goyal",
    "gujral", "gupta", "hegde", "hussain", "iyengar", "iyer", "jain", "johar",
    "joshi", "kapoor", "kashyap", "kaul", "kaur", "khan", "khanna", "kohli",
    "kumar", "kurup", "lal", "lamba", "lone", "malhotra", "malik", "mehta",
    "menon", "mirza", "mishra", "mittal", "mukherjee", "naidu", "naik", "nair",
    "nanda", "narasimha", "nawaz", "oberoi", "pande", "pandey", "parikh", "patel",
    "pathan", "pillai", "prasad", "puri", "qureshi", "rana", "rao", "rather",
    "rathore", "rawat", "reddy", "sabharwal", "sarabhai", "saxena", "sen", "seth",
    "shah", "sharma", "sheikh", "shetty", "shukla", "singh", "sinha", "srivastava",
    "subramanian", "syed", "talwar", "thakur", "tilak", "tiwari", "trivedi", "tyagi",
    "varma", "venkata", "verma", "vohra", "walia", "yadav",
)

val INDIAN_NAME_TOKENS: Set<String> = INDIAN_GIVEN_NAMES + INDIAN_SURNAMES

fun isNameToken(word: String): Boolean {
    val w = word.lowercase().replace(".", "")
    return w.length >= 3 && w in INDIAN_NAME_TOKENS
}
