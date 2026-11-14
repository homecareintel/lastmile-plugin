{
  "summary": "Imported CSV as dataset ds-2 (IMPORTED, 2 mapping question(s)).",
  "untrusted": true,
  "untrustedFields": [
    "mappingProposal"
  ],
  "datasetId": "ds-2",
  "status": "IMPORTED",
  "mappingProposal": {
    "needsAnswers": true,
    "questions": [
      {
        "column": "Start",
        "question": "Is 'Start' the visit's time window start or the caregiver's shift start?"
      },
      {
        "column": "Dur",
        "question": "Are the values in 'Dur' minutes or hours?"
      }
    ],
    "mapping": {
      "kind": "JOBS",
      "columns": [
        {
          "column": "Patient",
          "role": "ID"
        },
        {
          "column": "Address",
          "role": "ADDRESS"
        }
      ]
    }
  },
  "nextStep": "Answer the mapping questions with the customer, then call apply_mapping with the completed mapping."
}
