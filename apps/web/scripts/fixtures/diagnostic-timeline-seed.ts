import type { DiagnosticTimelineData } from "../../src/lib/diagnostic-timeline-data";

export const diagnosticTimelineSeed: DiagnosticTimelineData = {
  "metadata": {
    "title": "Diagnostic Timeline",
    "asOf": "2026-06-23",
    "range": {
      "start": "2026-02-01",
      "end": "2026-07-15"
    },
    "sourcePages": [
      {
        "label": "Test results summary",
        "href": "/wiki/diagnostics/test-results-summary"
      },
      {
        "label": "ctDNA / MRD monitoring",
        "href": "/wiki/diagnostics/ctdna-mrd"
      },
      {
        "label": "Diagnostics",
        "href": "/diagnostics"
      }
    ]
  },
  "sleeves": [
    {
      "id": "imaging",
      "label": "Imaging and Staging",
      "description": "Ultrasound, mammography, MRI, PET/CT, and research PET/CT studies.",
      "tone": "#9a6b52",
      "tracks": [
        {
          "id": "us-mammogram",
          "label": "US / mammogram",
          "kind": "events",
          "color": "#8f6a54",
          "events": [
            {
              "id": "us-2026-02-20",
              "date": "2026-02-20",
              "label": "Right breast ultrasound",
              "result": "Storage-only baseline ultrasound stack available.",
              "status": "reported",
              "diagnosticId": "diagnostic-2026-02-20-ultrasound",
              "details": [
                "Earliest surfaced imaging stack in the diagnostics viewer.",
                "Useful as pre-diagnosis comparison context."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/02-20-ultrasound"
                }
              ]
            },
            {
              "id": "us-mg-2026-03-20",
              "date": "2026-03-20",
              "label": "Diagnostic mammogram + right breast ultrasound",
              "result": "Hypoechoic non-mass lesion about 9.2 x 2.5 x 5.3 cm; enlarged right axillary nodes; left breast negative.",
              "status": "reported",
              "diagnosticId": "diagnostic-2026-03-20-ultrasound",
              "details": [
                "Spans most of the right upper hemisphere / all 4 quadrants.",
                "Raised nodal concern before axillary node biopsy."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/03-20-ultrasound"
                }
              ]
            }
          ]
        },
        {
          "id": "petct",
          "label": "PET / CT",
          "kind": "events",
          "color": "#a97855",
          "events": [
            {
              "id": "petct-2026-03-27",
              "date": "2026-03-27",
              "label": "FDG PET/CT vertex to mid-thigh",
              "result": "Hypermetabolic right breast and axillary disease; no specific evidence of distant hypermetabolic metastasis.",
              "status": "reported",
              "diagnosticId": "diagnostic-2026-03-27-petct",
              "details": [
                "Staging study supporting curative-intent Stage III framing.",
                "Includes CT chest and abdomen/pelvis components in the MyChart export."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/03-27-petct"
                }
              ]
            },
            {
              "id": "cu-grip-petct-2026-06-10",
              "date": "2026-06-10",
              "label": "64Cu-GRIP PET/CT",
              "result": "Research PET/CT transcription and comparison against the 3/27 FDG PET/CT plus 4/1 breast MRI.",
              "status": "reported",
              "diagnosticId": "diagnostic-2026-06-10-petct",
              "details": [
                "Granzyme B / immune-activity research imaging lane.",
                "Use the linked source analysis for lesion-level interpretation."
              ],
              "links": [
                {
                  "label": "Analysis",
                  "href": "/sources/diagnostics/06-10-cu-grip-petct-analysis"
                },
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/06-10-cu-grip-petct"
                }
              ]
            }
          ]
        },
        {
          "id": "mri",
          "label": "MRI",
          "kind": "events",
          "color": "#6f7f9d",
          "events": [
            {
              "id": "mri-2026-04-01",
              "date": "2026-04-01",
              "label": "Breast MRI",
              "result": "Right breast non-mass enhancement about 26 x 87 x 76 mm; right level I/II axillary nodes; suspicious right internal mammary nodes up to 5 x 9 mm; left breast BI-RADS 1.",
              "status": "reported",
              "diagnosticId": "diagnostic-2026-04-01-breast-mri",
              "details": [
                "Main baseline MRI for local extent and radiation-planning questions.",
                "Internal mammary nodes remain visible as a staging/radiation issue."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-01-breast-mri"
                },
                {
                  "label": "Analysis",
                  "href": "/sources/diagnostics/04-01-breast-mri-analysis"
                }
              ]
            },
            {
              "id": "mri-2026-06-26-planned",
              "date": "2026-06-26",
              "label": "Breast MRI",
              "result": "Planned taxol/AC crossover imaging gate.",
              "status": "planned",
              "details": [
                "Scheduled after the current as-of date.",
                "Near-term decision gate called out in consult notes and ctDNA interpretation."
              ],
              "links": [
                {
                  "label": "Visit tracker",
                  "href": "/sources/medical-records/ucsf-mychart-visits"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "pathology",
      "label": "Pathology and Tissue",
      "description": "Biopsy, pathology, germline testing, and tumor profiling results.",
      "tone": "#4d8f65",
      "tracks": [
        {
          "id": "biopsies",
          "label": "Biopsies",
          "kind": "events",
          "color": "#4d8f65",
          "events": [
            {
              "id": "breast-biopsy-2026-03-13",
              "date": "2026-03-13",
              "label": "Original breast biopsy",
              "result": "Invasive ductal carcinoma, Grade 3, ER 0%, PR 0%, HER2 IHC 0, Ki-67 40-50%; tiny 1 mm DCIS focus.",
              "status": "reported",
              "diagnosticId": "biopsy-2026-03-13",
              "details": [
                "Established triple-negative breast cancer diagnosis.",
                "UCSF block family later supports Natera and Personalis workflows."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/03-13-breast-biopsy-report"
                }
              ]
            },
            {
              "id": "axilla-biopsy-2026-03-23",
              "date": "2026-03-23",
              "label": "Right axillary node biopsy",
              "result": "Metastatic carcinoma consistent with breast origin; largest deposit 8 mm; SOX10 positive; block A1 about 30% invasive carcinoma.",
              "status": "reported",
              "diagnosticId": "biopsy-2026-03-23",
              "details": [
                "Confirms biopsy-proven nodal disease.",
                "Keeps clinical nodal burden explicit on the timeline."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/03-23-us-axilla-core-biopsy"
                }
              ]
            },
            {
              "id": "stanford-biopsy-2026-04-10",
              "date": "2026-04-10",
              "label": "Stanford research biopsy",
              "result": "IDC Grade 3; ER-/PR-; HER2 IHC 0 with ISH not amplified; Ki-67 61-70%; FFPE block A1 about 90% tumor.",
              "status": "reported",
              "diagnosticId": "biopsy-2026-04-10",
              "details": [
                "High-tumor FFPE pathology result used for tissue-routing decisions.",
                "Later correction revised fresh-frozen material to about 15 mg per vial."
              ],
              "links": [
                {
                  "label": "Pathology report",
                  "href": "/sources/diagnostics/04-10-kernis-path-report/04-10-kernis-path-report"
                }
              ]
            }
          ]
        },
        {
          "id": "genomics",
          "label": "Genomics",
          "kind": "events",
          "color": "#2f8b72",
          "events": [
            {
              "id": "hereditary-panel-2026-04-14",
              "date": "2026-04-14",
              "label": "Expanded hereditary cancer panel",
              "result": "Negative across 87 genes, including BRCA1/2, PALB2, ATM, CHEK2, TP53, PTEN, CDH1, and HRR genes.",
              "status": "reported",
              "details": [
                "Separates germline eligibility from somatic BRCA1 questions.",
                "Important context for Guardant and Altera interpretation."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-14-expanded-hereditary-panel"
                }
              ]
            },
            {
              "id": "altera-2026-05-12",
              "date": "2026-05-12",
              "label": "Natera Altera tumor profile",
              "result": "Somatic BRCA1 c.81-1G>A at 27% VAF; TMB low at 3 mut/Mb; MSI stable.",
              "status": "reported",
              "details": [
                "Confirms the Guardant360 BRCA1 plasma signal in tumor tissue.",
                "Supports somatic HRD hypothesis but does not establish formal HRD score."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/05-12-altera-tumor-profile"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "molecular",
      "label": "ctDNA and Molecular Response",
      "description": "Tumor-informed MRD, Guardant360, and planned molecular gates.",
      "tone": "#3f78b5",
      "tracks": [
        {
          "id": "signatera",
          "label": "Signatera",
          "kind": "series",
          "unit": "MTM/mL",
          "valueDomain": [
            0,
            0.9
          ],
          "color": "#3f78b5",
          "events": [
            {
              "id": "signatera-2026-04-01",
              "date": "2026-04-01",
              "label": "Signatera baseline",
              "value": 0.87,
              "valueLabel": "0.87 MTM/mL positive",
              "result": "Pretreatment tumor-informed MRD baseline; positive below analytical range.",
              "status": "reported",
              "details": [
                "Use the value directionally; qualitative call remains positive.",
                "Panel built from UCSF FFPE block SUS-26-1600 (A2)."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-18-signatera-ctdna"
                }
              ]
            },
            {
              "id": "signatera-2026-04-18",
              "date": "2026-04-18",
              "label": "Signatera week-3",
              "value": 0.48,
              "valueLabel": "0.48 MTM/mL positive",
              "result": "Week-3 on-treatment result; still positive but down from baseline.",
              "status": "reported",
              "details": [
                "Did not meet the favorable T1 binary-clearance signal.",
                "Reported below analytical range, so trend is more useful than exact magnitude."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-18-signatera-ctdna"
                }
              ]
            },
            {
              "id": "signatera-2026-05-28",
              "date": "2026-05-28",
              "label": "Signatera on-treatment",
              "value": 0.17,
              "valueLabel": "0.17 MTM/mL positive",
              "result": "Continued decline from 0.87 to 0.48 to 0.17 MTM/mL, but not clearance because the qualitative call remains positive.",
              "status": "reported",
              "details": [
                "Directionally favorable molecular response.",
                "Still not the same as molecular eradication."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/05-28-signatera-ctdna"
                }
              ]
            },
            {
              "id": "signatera-late-june-planned",
              "date": "2026-06-26",
              "label": "Signatera taxol/AC crossover",
              "result": "Planned late-June redraw near completion of Carbo/Taxol/Pembro.",
              "status": "planned",
              "details": [
                "Next cross-platform comparator after the June 9 Personalis result.",
                "Key T2-style gate for the Magbanua interpretation frame."
              ],
              "links": [
                {
                  "label": "ctDNA schedule",
                  "href": "/wiki/diagnostics/ctdna-mrd"
                }
              ]
            }
          ]
        },
        {
          "id": "personalis",
          "label": "NeXT Personal",
          "kind": "series",
          "unit": "PPM",
          "scale": "log",
          "valueDomain": [
            1,
            304
          ],
          "color": "#d97c24",
          "events": [
            {
              "id": "personalis-2026-04-20",
              "date": "2026-04-20",
              "label": "NeXT Personal Dx",
              "value": 304,
              "valueLabel": "ctDNA detected, 304 PPM",
              "result": "Early on-treatment Personalis MRD result; concordant with Signatera positivity.",
              "status": "reported",
              "details": [
                "Well above Personalis' 10 PPM low-quantification caveat.",
                "Report tissue ID SUS-26-01600-A2."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-20-personalis-next-personal-mrd/04-20-personalis-next-personal-mrd"
                }
              ]
            },
            {
              "id": "personalis-2026-06-09",
              "date": "2026-06-09",
              "label": "NeXT Personal Dx",
              "value": 1,
              "valueLabel": "ctDNA detected, 1 PPM",
              "result": "Major decline from 304 PPM to 1 PPM, but still detected.",
              "status": "reported",
              "details": [
                "Read the exact 1 PPM cautiously because it is below Personalis' 10 PPM precision-comparison caution.",
                "Qualitative call remains the load-bearing result."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/06-09-personalis-next-personal-mrd/06-09-personalis-next-personal-mrd"
                }
              ]
            }
          ]
        },
        {
          "id": "guardant",
          "label": "Guardant360",
          "kind": "events",
          "color": "#bf5f64",
          "events": [
            {
              "id": "guardant-2026-04-03",
              "date": "2026-04-03",
              "label": "Guardant360 Liquid",
              "result": "Tumor fraction 0.3%; BRCA1 0.2% VAF and TP53 0.1% VAF detected; MSI-high not detected; TMB not evaluable; HRD genomic instability not detected.",
              "status": "reported",
              "details": [
                "Tumor-naive CGP / variant-discovery anchor, not MRD-grade quantitation.",
                "Altera later confirms the BRCA1 signal in tumor tissue."
              ],
              "links": [
                {
                  "label": "Source page",
                  "href": "/sources/diagnostics/04-09-guardant360-ctdna"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "blood-counts",
      "label": "Blood Counts",
      "description": "CBC values across treatment, emphasizing ANC, hemoglobin, WBC, and platelets.",
      "tone": "#b05362",
      "tracks": [
        {
          "id": "anc",
          "label": "ANC",
          "kind": "series",
          "unit": "x10E9/L",
          "valueDomain": [
            0,
            5.5
          ],
          "color": "#b05362",
          "events": [
            {
              "id": "anc-2026-03-27",
              "date": "2026-03-27",
              "label": "ANC",
              "value": 4.82,
              "valueLabel": "4.82 x10E9/L",
              "result": "Pre-treatment baseline ANC.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/50-mar-27-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-04-02",
              "date": "2026-04-02",
              "label": "ANC",
              "value": 3.35,
              "valueLabel": "3.35 x10E9/L",
              "result": "Cycle-start ANC in range.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/44-apr-02-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-04-09",
              "date": "2026-04-09",
              "label": "ANC",
              "value": 2.63,
              "valueLabel": "2.63 x10E9/L",
              "result": "ANC in range.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/32-apr-09-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-04-17",
              "date": "2026-04-17",
              "label": "ANC",
              "value": 1.89,
              "valueLabel": "1.89 x10E9/L",
              "result": "ANC near lower range.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/29-apr-17-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-04-23",
              "date": "2026-04-23",
              "label": "ANC",
              "value": 1.96,
              "valueLabel": "1.96 x10E9/L",
              "result": "ANC near lower range.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/26-apr-23-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-04-30",
              "date": "2026-04-30",
              "label": "ANC",
              "value": 1.76,
              "valueLabel": "1.76 x10E9/L low",
              "result": "Borderline low ANC.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/22-apr-30-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-05-07",
              "date": "2026-05-07",
              "label": "ANC",
              "value": 0.79,
              "valueLabel": "0.79 x10E9/L low",
              "result": "ANC nadir in the available trend.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-05-08",
              "date": "2026-05-08",
              "label": "ANC",
              "value": 5.42,
              "valueLabel": "5.42 x10E9/L",
              "result": "Post-support rebound.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/16-may-08-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-05-11",
              "date": "2026-05-11",
              "label": "ANC",
              "value": 1.86,
              "valueLabel": "1.86 x10E9/L",
              "result": "Back near lower range.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/13-may-11-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-05-19",
              "date": "2026-05-19",
              "label": "ANC",
              "value": 1.63,
              "valueLabel": "1.63 x10E9/L low",
              "result": "Below range.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/07-may-19-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "anc-2026-05-26",
              "date": "2026-05-26",
              "label": "ANC",
              "value": 1.07,
              "valueLabel": "1.07 x10E9/L low",
              "result": "Below range; aligns with increased Zarzio support.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/04-may-26-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            }
          ]
        },
        {
          "id": "hemoglobin",
          "label": "Hemoglobin",
          "kind": "series",
          "unit": "g/dL",
          "valueDomain": [
            10,
            13
          ],
          "color": "#8a6fbc",
          "events": [
            {
              "id": "hgb-2026-03-27",
              "date": "2026-03-27",
              "label": "Hemoglobin",
              "value": 11.8,
              "valueLabel": "11.8 g/dL",
              "result": "Baseline hemoglobin.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/50-mar-27-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-04-02",
              "date": "2026-04-02",
              "label": "Hemoglobin",
              "value": 12.7,
              "valueLabel": "12.7 g/dL",
              "result": "Cycle-start hemoglobin.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/44-apr-02-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-04-09",
              "date": "2026-04-09",
              "label": "Hemoglobin",
              "value": 12.2,
              "valueLabel": "12.2 g/dL",
              "result": "Mild downward drift.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/32-apr-09-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-04-17",
              "date": "2026-04-17",
              "label": "Hemoglobin",
              "value": 11.5,
              "valueLabel": "11.5 g/dL",
              "result": "Treatment-associated anemia trend begins to show.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/29-apr-17-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-04-23",
              "date": "2026-04-23",
              "label": "Hemoglobin",
              "value": 11.8,
              "valueLabel": "11.8 g/dL",
              "result": "Stable mild anemia context.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/26-apr-23-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-04-30",
              "date": "2026-04-30",
              "label": "Hemoglobin",
              "value": 11.5,
              "valueLabel": "11.5 g/dL",
              "result": "Mild anemia persists.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/22-apr-30-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-05-07",
              "date": "2026-05-07",
              "label": "Hemoglobin",
              "value": 11.1,
              "valueLabel": "11.1 g/dL low",
              "result": "Low hemoglobin.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-05-08",
              "date": "2026-05-08",
              "label": "Hemoglobin",
              "value": 10.9,
              "valueLabel": "10.9 g/dL low",
              "result": "Low hemoglobin.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/16-may-08-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-05-11",
              "date": "2026-05-11",
              "label": "Hemoglobin",
              "value": 11.8,
              "valueLabel": "11.8 g/dL",
              "result": "Partial rebound.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/13-may-11-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-05-19",
              "date": "2026-05-19",
              "label": "Hemoglobin",
              "value": 10.7,
              "valueLabel": "10.7 g/dL low",
              "result": "Mild anemia persists.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/07-may-19-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "hgb-2026-05-26",
              "date": "2026-05-26",
              "label": "Hemoglobin",
              "value": 10.7,
              "valueLabel": "10.7 g/dL low",
              "result": "Mild anemia persists.",
              "status": "flagged",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/04-may-26-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            }
          ]
        },
        {
          "id": "platelets",
          "label": "Platelets",
          "kind": "series",
          "unit": "x10E9/L",
          "valueDomain": [
            140,
            260
          ],
          "color": "#4f8b57",
          "events": [
            {
              "id": "plt-2026-03-27",
              "date": "2026-03-27",
              "label": "Platelets",
              "value": 213,
              "valueLabel": "213 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/50-mar-27-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-04-02",
              "date": "2026-04-02",
              "label": "Platelets",
              "value": 249,
              "valueLabel": "249 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/44-apr-02-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-04-09",
              "date": "2026-04-09",
              "label": "Platelets",
              "value": 229,
              "valueLabel": "229 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/32-apr-09-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-04-17",
              "date": "2026-04-17",
              "label": "Platelets",
              "value": 235,
              "valueLabel": "235 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/29-apr-17-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-04-23",
              "date": "2026-04-23",
              "label": "Platelets",
              "value": 219,
              "valueLabel": "219 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/26-apr-23-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-04-30",
              "date": "2026-04-30",
              "label": "Platelets",
              "value": 195,
              "valueLabel": "195 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/22-apr-30-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-05-07",
              "date": "2026-05-07",
              "label": "Platelets",
              "value": 161,
              "valueLabel": "161 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/19-may-07-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-05-08",
              "date": "2026-05-08",
              "label": "Platelets",
              "value": 160,
              "valueLabel": "160 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/16-may-08-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-05-11",
              "date": "2026-05-11",
              "label": "Platelets",
              "value": 191,
              "valueLabel": "191 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/13-may-11-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-05-19",
              "date": "2026-05-19",
              "label": "Platelets",
              "value": 162,
              "valueLabel": "162 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/07-may-19-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            },
            {
              "id": "plt-2026-05-26",
              "date": "2026-05-26",
              "label": "Platelets",
              "value": 181,
              "valueLabel": "181 x10E9/L",
              "result": "Normal.",
              "status": "reported",
              "links": [
                {
                  "label": "CBC",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/04-may-26-2026-cbc-w-auto-diff-lab-only"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "chemistry-endocrine",
      "label": "Chemistry and Endocrine",
      "description": "CMP, thyroid/cortisol, and hCG trend checkpoints.",
      "tone": "#c28a22",
      "tracks": [
        {
          "id": "alt",
          "label": "ALT",
          "kind": "series",
          "unit": "U/L",
          "valueDomain": [
            0,
            55
          ],
          "color": "#c28a22",
          "events": [
            {
              "id": "alt-2026-04-02",
              "date": "2026-04-02",
              "label": "ALT",
              "value": 18,
              "valueLabel": "18 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/37-apr-02-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-04-09",
              "date": "2026-04-09",
              "label": "ALT",
              "value": 18,
              "valueLabel": "18 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/30-apr-09-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-04-17",
              "date": "2026-04-17",
              "label": "ALT",
              "value": 23,
              "valueLabel": "23 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/27-apr-17-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-04-23",
              "date": "2026-04-23",
              "label": "ALT",
              "value": 18,
              "valueLabel": "18 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/25-apr-23-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-04-30",
              "date": "2026-04-30",
              "label": "ALT",
              "value": 28,
              "valueLabel": "28 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/20-apr-30-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-05-07",
              "date": "2026-05-07",
              "label": "ALT",
              "value": 29,
              "valueLabel": "29 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/18-may-07-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-05-11",
              "date": "2026-05-11",
              "label": "ALT",
              "value": 36,
              "valueLabel": "36 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/11-may-11-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-05-19",
              "date": "2026-05-19",
              "label": "ALT",
              "value": 30,
              "valueLabel": "30 U/L",
              "result": "In range.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/05-may-19-2026-comprehensive-metabolic-panel"
                }
              ]
            },
            {
              "id": "alt-2026-05-26",
              "date": "2026-05-26",
              "label": "ALT",
              "value": 44,
              "valueLabel": "44 U/L",
              "result": "In range; latest CMP stable.",
              "status": "reported",
              "links": [
                {
                  "label": "CMP",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/02-may-26-2026-comprehensive-metabolic-panel"
                }
              ]
            }
          ]
        },
        {
          "id": "hcg",
          "label": "hCG",
          "kind": "series",
          "unit": "IU/L",
          "scale": "log",
          "valueDomain": [
            3,
            1472
          ],
          "color": "#6aa6a0",
          "events": [
            {
              "id": "hcg-2026-04-02",
              "date": "2026-04-02",
              "label": "hCG",
              "value": 1472,
              "valueLabel": "1,472 IU/L",
              "result": "Baseline post-pregnancy-decision lab.",
              "status": "reported",
              "links": [
                {
                  "label": "hCG",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/34-apr-02-2026-hcg-pregnancy-quant"
                }
              ]
            },
            {
              "id": "hcg-2026-04-09",
              "date": "2026-04-09",
              "label": "hCG",
              "value": 286,
              "valueLabel": "286 IU/L",
              "result": "Falling.",
              "status": "reported",
              "links": [
                {
                  "label": "hCG",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/33-apr-09-2026-hcg-pregnancy-quant"
                }
              ]
            },
            {
              "id": "hcg-2026-04-30",
              "date": "2026-04-30",
              "label": "hCG",
              "value": 18,
              "valueLabel": "18 IU/L",
              "result": "Near-negative / still detectable.",
              "status": "reported",
              "links": [
                {
                  "label": "hCG",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/23-apr-30-2026-hcg-pregnancy-quant"
                }
              ]
            },
            {
              "id": "hcg-2026-05-26",
              "date": "2026-05-26",
              "label": "hCG",
              "value": 3,
              "valueLabel": "3 IU/L",
              "result": "Essentially resolved.",
              "status": "reported",
              "links": [
                {
                  "label": "hCG",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/03-may-26-2026-hcg-pregnancy-quant"
                }
              ]
            }
          ]
        },
        {
          "id": "endocrine",
          "label": "Thyroid / cortisol",
          "kind": "events",
          "color": "#6f8fba",
          "events": [
            {
              "id": "thyroid-cortisol-2026-05-11",
              "date": "2026-05-11",
              "label": "TSH / T4 / T3 / cortisol",
              "result": "TSH 1.98 mIU/L, free T4 12 pmol/L, free T3 4.4 pmol/L, cortisol 9.1 ug/dL; all in range.",
              "status": "reported",
              "details": [
                "Checkpoint for endocrine toxicity monitoring during immunotherapy.",
                "No current thyroid/cortisol signal in the May 11 panel."
              ],
              "links": [
                {
                  "label": "TSH",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/10-may-11-2026-thyroid-stimulating-hormone-tsh"
                },
                {
                  "label": "Cortisol",
                  "href": "/sources/diagnostics/ucsf-mychart-test-results/14-may-11-2026-cortisol"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
