{
  "summary": "9 rule type(s) and 6 intent(s) for shipment.",
  "untrusted": false,
  "mode": "shipment",
  "rules": [
    {
      "type": "shift"
    },
    {
      "type": "break"
    },
    {
      "type": "attributeSkill"
    },
    {
      "type": "objective"
    },
    {
      "type": "priority"
    },
    {
      "type": "maxJobs"
    },
    {
      "type": "capacity"
    },
    {
      "type": "penalty"
    },
    {
      "type": "unsupported"
    }
  ],
  "selectorGrammar": "{attribute, values}; attribute 'id' for business ids; omit for all.",
  "notes": "maxJobs {workers, maxJobs, balanceSchedule} caps the jobs per worker per day. unsupported {text, reason} records a rule the vocabulary or the mode cannot express; it is never approximated.",
  "intents": []
}
