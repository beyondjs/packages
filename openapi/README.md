# OpenAPI Merge Instructions

To merge the OpenAPI YAML files into a single file, follow these steps:

1. **Install swagger-cli**:

```sh
npm install -g swagger-cli
```

2. **Merge the OpenAPI YAML files**:

```sh
swagger-cli bundle -o merged.yaml --type yaml main.yaml
```
