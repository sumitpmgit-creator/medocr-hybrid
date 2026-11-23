---
license: mit
dataset_info:
  features:
    - name: image
      dtype: image
    - name: md5_image
      dtype: string
    - name: sample_prompt
      dtype: string
    - name: rubrics
      dtype: string
    - name: document_type
      dtype: string
  splits:
    - name: test
      num_bytes: 28800000
      num_examples: 288
  download_size: 24480000
  dataset_size: 28800000
task_categories:
  - image-classification
  - image-to-text
language:
  - en
tags:
  - dataset
  - image
  - computer-vision
pretty_name: Medical Records Parsing Validation Set
size_categories:
  - n<1K
---

# Medical Records Parsing Validation Set

## Dataset Composition and Clinical Relevance
The Eka Medical Records Parsing Dataset empowers evaluation of AI systems designed to extract structured information from unstructured medical documents, enabling true digitisation of healthcare data while maintaining clinical accuracy. 
The dataset comprise 288 carefully selected images of laboratory reports and prescriptions representing diverse formats and templates encountered in Indian healthcare settings. This variety ensures comprehensive evaluation of parsing systems across different document types and layouts.
For details read this [blog](https://info.eka.care/services/advancing-healthcare-ai-evaluation-in-india-ekacare-releases-four-evaluation-datasets).
## Privacy-First Approach and Expert Annotation
All medical documents included in this dataset are sourced exclusively from EkaCare’s PHR application, and through its internal users. Every document undergoes rigorous personally identifiable information (PII) redaction processes to ensure complete privacy protection. Ground truth labelling is meticulously performed by EkaCare's internal medical team, guaranteeing clinical accuracy and relevance.

## Rubric based Evaluation Methodology
This dataset uses a rubric-based evaluation system with large language models acting as evaluators. Originally developed by OpenAI for HealthBench, we have adapted and expanded this approach across multiple datasets in our collection. This method effectively tackles the difficult problem of measuring extraction accuracy across diverse document types, where conventional alignment-based metrics often prove inadequate.
The evaluation rubrics are automatically created using a state-of-the-art LLM utilising ground truth structured JSON data that was carefully annotated by medical experts. Each rubric consists of an objective question designed for binary true/false assessment by an LLM judge. The final score for each dataset entry represents the average of all true/false evaluations across the complete set of rubrics for that specific data point.


## Dataset Information

### Splits

- **train**: 0 samples
- **test**: 288 samples

### Data Fields

The dataset includes the following columns:
- **image**: Image data
- **md5_image**: String data
- **sample_prompt**: String data
- **rubrics**: String data
- **document_type**: String data

## Technical Details

- **Total samples**: 288
- **Shard length**: 20
- **Number of splits**: 2

## Contributor / Annotator List
- Dr Rajshree Badami
- Dr Anushree Rana
- Dr Kumar Sarthak
- Dr Shika Sharadha Raghunath Desai
- Yashasvee Singh 
- Soumya Anshu
- Dr Sanjana SN

## License
This dataset is released under the MIT License, enabling broad use while maintaining attribution requirements.