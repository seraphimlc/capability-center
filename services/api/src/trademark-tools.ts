// Trademark capability definitions imported from the upstream MCP tools/list.
// Keep names, summaries and schemas white-label: no upstream vendor names here.

export type TrademarkToolDef = {
  key: string;
  upstream: string;
  name: string;
  summary: string;
  descriptionMd: string;
  pricingCredits: number;
  schema: Record<string, unknown>;
  examples: Record<string, unknown>[];
};

export const TRADEMARK_TOOLS: TrademarkToolDef[] = [
  {
    key: "trademark-similar-search",
    upstream: "近似商标查询",
    name: "近似商标检索",
    summary: "按名称检索美国、欧盟、英国、加拿大、日本、越南的近似商标，用于上架或注册前的初步排查。",
    descriptionMd: "按商标名称检索字形、读音或含义近似的已申请或已注册商标，支持美国、欧盟、英国、加拿大、日本、越南，默认美国。结果只代表当前条件下的候选记录，不构成法律意见或侵权结论。",
    pricingCredits: 20,
    schema: {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "keyword": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "description": "商标名称或文字，支持 * 通配符；不要附加查询说明词。"
        },
        "country": {
          "description": "单个国家或地区代码，例如 US；未提供 countries 时使用。",
          "type": "string",
          "minLength": 2,
          "maxLength": 10
        },
        "countries": {
          "description": "多个国家或地区代码，例如 [US, GB]；优先于 country。",
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 2,
            "maxLength": 10
          }
        },
        "category_numbers": {
          "default": [],
          "description": "商标大类编号，例如 [2] 或 [2, 25]；对应网页请求的 categoryList。",
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "status_list": {
          "default": [],
          "description": "商标一级状态，使用接口返回的原始文本，例如 [待分配审查员]。",
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "two_status_list": {
          "default": [],
          "description": "商标细分状态，使用接口返回的原始文本；对应 twoStatusList。",
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "apply_date_start": {
          "description": "申请日期开始，格式 YYYY-MM-DD；需要与结束日期同时提供。",
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "apply_date_end": {
          "description": "申请日期结束，格式 YYYY-MM-DD；需要与开始日期同时提供。",
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "owner_names": {
          "default": [],
          "description": "申请人/持有人名称数组，对应 ownerNameList。",
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "organized_list": {
          "default": [],
          "description": "申请地区数组，对应 organizedList。",
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "page_index": {
          "default": 1,
          "description": "结果页码，从 1 开始；默认 1。",
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "page_size": {
          "default": 30,
          "description": "每页数量，默认 30，最大 50。",
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        }
      },
      "required": [
        "keyword"
      ],
      "x-hints": [
        "商标",
        "近似商标",
        "侵权",
        "注册",
        "trademark"
      ],
      "x-countries": [
        "US",
        "EU",
        "GB",
        "CA",
        "JP",
        "VN"
      ]
    },
    examples: [
      {
        "keyword": "CAMPING",
        "countries": [
          "US"
        ],
        "page_size": 10
      }
    ],
  },
  {
    key: "trademark-detail",
    upstream: "商标详情查询",
    name: "美国商标详情",
    summary: "按名称、申请号或注册号查询美国商标的状态、持有人、律师、尼斯分类和关键日期。",
    descriptionMd: "按商标名称、申请号或注册号查询美国商标信息。提供号码时返回精确详情；只提供名称时先返回候选列表，选定号码后再查完整详情。结果来自公开商标数据，不构成法律意见。",
    pricingCredits: 10,
    schema: {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "keyword": {
          "description": "商标名称。与申请号/注册号至少提供一个。",
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "country": {
          "description": "国家或地区代码，例如 US；默认 US。",
          "type": "string",
          "minLength": 2,
          "maxLength": 10
        },
        "trademark_number": {
          "description": "商标申请号、受理号或注册号；有号码时优先精确查询。",
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "x-hints": [
        "商标详情",
        "申请号",
        "注册号",
        "持有人",
        "trademark"
      ],
      "x-countries": [
        "US"
      ]
    },
    examples: [
      {
        "trademark_number": "97175303",
        "country": "US"
      }
    ],
  },
  {
    key: "trademark-nice-class",
    upstream: "尼斯分类查询",
    name: "尼斯分类查询",
    summary: "按商品/服务关键词或分类号查询美国尼斯分类的大类与小类，用于确定商标申请类别。",
    descriptionMd: "查询美国尼斯分类的大类和小类项目，可按商品或服务关键词、分类号检索。适合回答“某商品属于哪一类”以及查看指定类别下的小类。分类结果仅作参考，正式申请前建议由代理机构复核。",
    pricingCredits: 5,
    schema: {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "country_code": {
          "description": "国家或地区代码，例如 US；默认 US。",
          "type": "string",
          "minLength": 2,
          "maxLength": 10
        },
        "category_name": {
          "description": "商品或服务关键词，例如 software、coffee shop、服装。",
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "category_number": {
          "description": "尼斯分类号，例如 9、25、42，也兼容 025。",
          "type": "string",
          "pattern": "^\\d{1,3}$"
        },
        "page": {
          "default": 1,
          "description": "相关小类结果页码，从 1 开始。",
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "limit": {
          "default": 10,
          "description": "每页相关小类数量，默认 10，最大 50。",
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        }
      },
      "x-hints": [
        "尼斯分类",
        "商标分类",
        "类别",
        "trademark"
      ],
      "x-countries": [
        "US"
      ]
    },
    examples: [
      {
        "country_code": "US",
        "category_number": "11",
        "limit": 10
      }
    ],
  },
];
