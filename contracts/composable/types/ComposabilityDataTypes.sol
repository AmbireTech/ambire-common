// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Parameter type for composition
enum InputParamFetcherType {
  RAW_BYTES, // Already encoded bytes
  STATIC_CALL // Perform a static call
}

enum OutputParamFetcherType {
  EXEC_RESULT, // The return of the execution call
  STATIC_CALL // Call to some other function
}

// Constraint type for parameter validation
enum ConstraintType {
  EQ, // Equal to
  GTE, // Greater than or equal to
  LTE, // Less than or equal to
  IN // In range
}

// Constraint for parameter validation
struct Constraint {
  ConstraintType constraintType;
  bytes referenceData;
}

// Structure to define parameter composition
struct InputParam {
  InputParamFetcherType fetcherType; // How to fetch the parameter
  bytes paramData;
  Constraint[] constraints;
}

// Structure to define return value handling
struct OutputParam {
  OutputParamFetcherType fetcherType; // How to fetch the parameter
  bytes paramData;
}

// Structure to define a composable execution
struct ComposableExecution {
  address to;
  uint256 value;
  bytes4 functionSig;
  InputParam[] inputParams;
  OutputParam[] outputParams;
}
