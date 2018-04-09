declare module 'sarif' {

    /**
    * SARIF Log Interface based on the Static Analysis Results Format (SARIF) Version 1.0.0 JSON Schema: a standard format for the output of static analysis and other tools.
    */
    export interface Log {
        /**
        *  The URI of the JSON schema corresponding to the version.
        */
        $schema: string;

        /**
        *  The SARIF format version of this log file.
        */
        version: string;

        /**
         *  The set of runs contained in this log file.
         */
        runs: Run[];
    }

    /**
    * An annotation used to express code flows through a method or other locations that are related to a result.
    */
    export interface AnnotatedCodeLocation {
        /**
        *  OBSOLETE (use "step" instead): An identifier for the location, unique within the scope of the code flow within which it occurs.
        */
        id: any;

        /**
        *  The 0-based sequence number of the location in the code flow within which it occurs.
        */
        step: number;

        /**
        *  A file location to which this annotation refers.
        */
        physicalLocation: PhysicalLocation;

        /**
        *  The fully qualified name of the method or function that is executing.
        */
        fullyQualifiedLogicalName: string;

        /**
        *  A key used to retrieve the annotation's logicalLocation from the logicalLocations dictionary.
        */
        logicalLocationKey: string;

        /**
        *  The name of the module that contains the code that is executing.
        */
        module: string;

        /**
        *  The thread identifier of the code that is executing.
        */
        threadId: number;

        /**
        *  A message relevant to this annotation.
        */
        message: string;

        /**
        *  Categorizes the location.
        */
        kind: AnnotatedCodeLocation.kind;

        /**
        *  Classifies state transitions in code locations relevant to a taint analysis.
        */
        taintKind: AnnotatedCodeLocation.taintKind;

        /**
        *  The fully qualified name of the target on which this location operates. For an annotation of kind 'call', for example, the target refers to the fully qualified logical name of the function called from this location.
        */
        target: string;

        /**
        *  An ordered set of strings that comprise input or return values for the current operation. For an annotation of kind 'call', for example, this property may hold the ordered list of arguments passed to the callee.
        */
        values: string[];

        /**
        *  A dictionary, each of whose keys specifies a variable or expression, the associated value of which represents the variable or expression value. For an annotation of kind 'continuation', for example, this dictionary might hold the current assumed values of a set of global variables.
        */
        state: Map<string, any>;

        /**
        *  A key used to retrieve the target's logicalLocation from the logicalLocations dictionary.
        */
        targetKey: string;

        /**
        *  OBSOLETE (use "importance" instead): True if this location is essential to understanding the code flow in which it occurs.
        */
        essential: boolean;

        /**
        *  Specifies the importance of this location in understanding the code flow in which it occurs. The order from most to least important is "essential", "important", "unimportant". Default: "important".
        */
        importance: AnnotatedCodeLocation.importance;

        /**
        *  The source code at the specified location.
        */
        snippet: string;

        /**
        *  A set of messages relevant to the current annotated code location.
        */
        annotations: Annotation[];

        /**
        *  Key/value pairs that provide additional information about the code location.
        */
        properties: Map<any, any>;

    }

    export namespace AnnotatedCodeLocation {
        export const enum kind {
            alias = "alias",
            assignment = "assignment",
            branch = "branch",
            call = "call",
            callReturn = "callReturn",
            continuation = "continuation",
            declaration = "declaration",
            functionEnter = "functionEnter",
            functionExit = "functionExit",
            functionReturn = "functionReturn",
            usage = "usage",
        }
        export const enum taintKind {
            source = "source",
            sink = "sink",
            sanitizer = "sanitizer",
        }
        export const enum importance {
            important = "important",
            essential = "essential",
            unimportant = "unimportant",
        }
    }

    /**
    * undefined
    */
    export interface Annotation {
        /**
        * [Required] A message relevant to a code location
        */
        message: string;

        /**
        * [Required] An array of 'physicalLocation' objects associated with the annotation.
        */
        locations: PhysicalLocation[];

    }

    /**
    * undefined
    */
    export interface CodeFlow {
        /**
        *  A message relevant to the code flow
        */
        message: string;

        /**
        * [Required] An array of 'annotatedCodeLocation' objects, each of which describes a single location visited by the tool in the course of producing the result.
        */
        locations: AnnotatedCodeLocation[];

        /**
        *  Key/value pairs that provide additional information about the code flow.
        */
        properties: Map<any, any>;

    }

    /**
    * undefined
    */
    export interface Exception {
        /**
        *  A string that identifies the kind of exception, for example, the fully qualified type name of an object that was thrown, or the symbolic name of a signal.
        */
        kind: string;

        /**
        *  A string that describes the exception.
        */
        message: string;

        /**
        *  The sequence of function calls leading to the exception.
        */
        stack: Stack;

        /**
        *  An array of exception objects each of which is considered a cause of this exception.
        */
        innerExceptions: Exception[];

    }

    /**
    * A change to a single file.
    */
    export interface FileChange {
        /**
        * [Required] A string that represents the location of the file to change as a valid URI.
        */
        uri: string;

        /**
        *  A string that identifies the conceptual base for the 'uri' property (if it is relative), e.g.,'$(SolutionDir)' or '%SRCROOT%'.
        */
        uriBaseId: string;

        /**
        * [Required] An array of replacement objects, each of which represents the replacement of a single range of bytes in a single file specified by 'uri'.
        */
        replacements: Replacement[];

    }

    /**
    * A single file. In some cases, this file might be nested within another file.
    */
    export interface File {
        /**
        *  The path to the file within its containing file.
        */
        uri: string;

        /**
        *  A string that identifies the conceptual base for the 'uri' property (if it is relative), e.g.,'$(SolutionDir)' or '%SRCROOT%'.
        */
        uriBaseId: string;

        /**
        *  Identifies the key of the immediate parent of the file, if this file is nested.
        */
        parentKey: string;

        /**
        *  The offset in bytes of the file within its containing file.
        */
        offset: number;

        /**
        *  The length of the file in bytes.
        */
        length: number;

        /**
        *  The MIME type (RFC 2045) of the file.
        */
        mimeType: string;

        /**
        *  The contents of the file, expressed as a MIME Base64-encoded byte sequence.
        */
        contents: string;

        /**
        *  An array of hash objects, each of which specifies a hashed value for the file, along with the name of the algorithm used to compute the hash.
        */
        hashes: Hash[];

        /**
        *  Key/value pairs that provide additional information about the file.
        */
        properties: Map<any, any>;

    }

    /**
    * A proposed fix for the problem represented by a result object. A fix specifies a set of file to modify. For each file, it specifies a set of bytes to remove, and provides a set of new bytes to replace them.
    */
    export interface Fix {
        /**
        * [Required] A string that describes the proposed fix, enabling viewers to present a proposed change to an end user.
        */
        description: string;

        /**
        * [Required] One or more file changes that comprise a fix for a result.
        */
        fileChanges: FileChange[];

    }

    /**
    * Contains information that can be used to construct a formatted message that describes a result.
    */
    export interface FormattedRuleMessage {
        /**
        * [Required] A string that identifies the message format used to format the message that describes this result. The value of formatId must correspond to one of the names in the set of name/value pairs contained in the 'messageFormats' property of the rule object whose 'id' property matches the 'ruleId' property of this result.
        */
        formatId: string;

        /**
        *  An array of strings that will be used, in combination with a message format, to construct a result message.
        */
        arguments: string[];

    }

    /**
    * A hash value of some file or collection of files, together with the algorithm used to compute the hash.
    */
    export interface Hash {
        /**
        * [Required] The hash value of some file or collection of files, computed by the algorithm named in the 'algorithm' property.
        */
        value: string;

        /**
        * [Required] The name of the algorithm used to compute the hash value specified in the 'value' property.
        */
        algorithm: Hash.algorithm;

    }

    export namespace Hash {
        export const enum algorithm {
            authentihash = "authentihash",
            blake256 = "blake256",
            blake512 = "blake512",
            ecoh = "ecoh",
            fsb = "fsb",
            gost = "gost",
            groestl = "groestl",
            has160 = "has160",
            haval = "haval",
            jh = "jh",
            md2 = "md2",
            md4 = "md4",
            md5 = "md5",
            md6 = "md6",
            radioGatun = "radioGatun",
            ripeMD = "ripeMD",
            ripeMD128 = "ripeMD128",
            ripeMD160 = "ripeMD160",
            ripeMD320 = "ripeMD320",
            sdhash = "sdhash",
            sha1 = "sha1",
            sha224 = "sha224",
            sha256 = "sha256",
            sha384 = "sha384",
            sha512 = "sha512",
            sha3 = "sha3",
            skein = "skein",
            snefru = "snefru",
            spectralHash = "spectralHash",
            ssdeep = "ssdeep",
            swifft = "swifft",
            tiger = "tiger",
            tlsh = "tlsh",
            whirlpool = "whirlpool",
        }
    }

    /**
    * The runtime environment of the analysis tool run.
    */
    export interface Invocation {
        /**
        *  The command line used to invoke the tool.
        */
        commandLine: string;

        /**
        *  The contents of any response files specified on the tool's command line.
        */
        responseFiles: any;

        /**
        *  The date and time at which the run started. See "Date/time properties" in the SARIF spec for the required format.
        */
        startTime: string;

        /**
        *  The date and time at which the run ended. See "Date/time properties" in the  SARIF spec for the required format.
        */
        endTime: string;

        /**
        *  The machine that hosted the analysis tool run.
        */
        machine: string;

        /**
        *  The account that ran the analysis tool.
        */
        account: string;

        /**
        *  The process id for the analysis tool run.
        */
        processId: number;

        /**
        *  The fully qualified path to the analysis tool.
        */
        fileName: string;

        /**
        *  The working directory for the analysis rool run.
        */
        workingDirectory: string;

        /**
        *  The environment variables associated with the analysis tool process, expressed as key/value pairs.
        */
        environmentVariables: Map<string, string>;

        /**
        *  Key/value pairs that provide additional information about the run.
        */
        properties: Map<any, any>;

    }

    /**
    * The location where an analysis tool produced a result.
    */
    export interface Location {
        /**
        *  Identifies the file that the analysis tool was instructed to scan. This need not be the same as the file where the result actually occurred.
        */
        analysisTarget: PhysicalLocation;

        /**
        *  Identifies the file where the analysis tool produced the result.
        */
        resultFile: PhysicalLocation;

        /**
        *  The human-readable fully qualified name of the logical location where the analysis tool produced the result. If 'logicalLocationKey' is not specified, this member is can used to retrieve the location logicalLocation from the logicalLocations dictionary, if one exists.
        */
        fullyQualifiedLogicalName: string;

        /**
        *  A key used to retrieve the location logicalLocation from the logicalLocations dictionary, when the string specified by 'fullyQualifiedLogicalName' is not unique.
        */
        logicalLocationKey: string;

        /**
        *  The machine-readable fully qualified name for the logical location where the analysis tool produced the result, such as the mangled function name provided by a C++ compiler that encodes calling convention, return type and other details along with the function name.
        */
        decoratedName: string;

        /**
        *  Key/value pairs that provide additional information about the location.
        */
        properties: Map<any, any>;

    }

    /**
    * A logical location of a construct that produced a result.
    */
    export interface LogicalLocation {
        /**
        *  Identifies the construct in which the result occurred. For example, this property might contain the name of a class or a method.
        */
        name: string;

        /**
        *  Identifies the key of the immediate parent of the construct in which the result was detected. For example, this property might point to a logical location that represents the namespace that holds a type.
        */
        parentKey: string;

        /**
        *  The type of construct this logicalLocationComponent refers to. Should be one of 'function', 'member', 'module', 'namespace', 'package', 'resource', or 'type', if any of those accurately describe the construct.
        */
        kind: string;

    }

    /**
    * Describes a condition relevant to the tool itself, as opposed to being relevant to a target being analyzed by the tool.
    */
    export interface Notification {
        /**
        *  An identifier for the condition that was encountered.
        */
        id: string;

        /**
        *  The stable, unique identifier of the rule (if any) to which this notification is relevant. If 'ruleKey' is not specified, this member can be used to retrieve rule metadata from the rules dictionary, if it exists.
        */
        ruleId: string;

        /**
        *  A key used to retrieve the rule metadata from the rules dictionary that is relevant to the notificationn.
        */
        ruleKey: string;

        /**
        *  The file and region relevant to this notification.
        */
        physicalLocation: PhysicalLocation;

        /**
        * [Required] A string that describes the condition that was encountered.
        */
        message: string;

        /**
        *  A value specifying the severity level of the notification.
        */
        level: Notification.level;

        /**
        *  The thread identifier of the code that generated the notification.
        */
        threadId: number;

        /**
        *  The date and time at which the analysis tool generated the notification.
        */
        time: string;

        /**
        *  The runtime exception, if any, relevant to this notification.
        */
        exception: Exception;

        /**
        *  Key/value pairs that provide additional information about the notification.
        */
        properties: Map<any, any>

    }

    export namespace Notification {
        export const enum level {
            note = "note",
            warning = "warning",
            error = "error",
        }
    }

    /**
    * A physical location relevant to a result. Specifies a reference to a programming artifact together with a range of bytes or characters within that artifact.
    */
    export interface PhysicalLocation {
        /**
        *  The location of the file as a valid URI.
        */
        uri: string;

        /**
        *  A string that identifies the conceptual base for the 'uri' property (if it is relative), e.g.,'$(SolutionDir)' or '%SRCROOT%'.
        */
        uriBaseId: string;

        /**
        *  The region within the file where the result was detected.
        */
        region: Region;

    }

    /**
    * A region within a file where a result was detected.
    */
    export interface Region {
        /**
        *  The line number of the first character in the region.
        */
        startLine: number;

        /**
        *  The column number of the first character in the region.
        */
        startColumn: number;

        /**
        *  The line number of the last character in the region.
        */
        endLine: number;

        /**
        *  The column number of the last character in the region.
        */
        endColumn: number;

        /**
        *  The zero-based offset from the beginning of the file of the first byte or character in the region.
        */
        offset: number;

        /**
        *  The length of the region in bytes or characters.
        */
        length: number;

    }

    /**
    * The replacement of a single range of bytes in a file. Specifies the location within the file where the replacement is to be made, the number of bytes to remove at that location, and a sequence of bytes to insert at that location.
    */
    export interface Replacement {
        /**
        * [Required] A non-negative integer specifying the offset in bytes from the beginning of the file at which bytes are to be removed, inserted or both. An offset of 0 shall denote the first byte in the file.
        */
        offset: number;

        /**
        *  The number of bytes to delete, starting at the byte offset specified by offset, measured from the beginning of the file.
        */
        deletedLength: number;

        /**
        *  The MIME Base64-encoded byte sequence to be inserted at the byte offset specified by the 'offset' property, measured from the beginning of the file.
        */
        insertedBytes: string;

    }

    /**
    * A result produced by an analysis tool.
    */
    export interface Result {
        /**
        *  The stable, unique identifier of the rule (if any) to which this notification is relevant. If 'ruleKey' is not specified, this member can be used to retrieve rule metadata from the rules dictionary, if it exists.
        */
        ruleId: string;

        /**
        *  A key used to retrieve the rule metadata from the rules dictionary that is relevant to the notificationn.
        */
        ruleKey: string;

        /**
        *  A value specifying the severity level of the result. If this property is not present, its implied value is 'warning'.
        */
        level: Result.level;

        /**
        *  A string that describes the result. The first sentence of the message only will be displayed when visible space is limited.
        */
        message: string;

        /**
        *  A 'formattedRuleMessage' object that can be used to construct a formatted message that describes the result. If the 'formattedMessage' property is present on a result, the 'fullMessage' property shall not be present. If the 'fullMessage' property is present on an result, the 'formattedMessage' property shall not be present
        */
        formattedRuleMessage: FormattedRuleMessage;

        /**
        *  One or more locations where the result occurred. Specify only one location unless the problem indicated by the result can only be corrected by making a change at every specified location.
        */
        locations: Location[];

        /**
        *  A source code or other file fragment that illustrates the result.
        */
        snippet: string;

        /**
        *  A unique identifer for the result.
        */
        id: string;

        /**
        *  A string that contributes to the unique identity of the result.
        */
        toolFingerprintContribution: string;

        /**
        *  An array of 'stack' objects relevant to the result.
        */
        stacks: Stack[];

        /**
        *  An array of 'codeFlow' objects relevant to the result.
        */
        codeFlows: CodeFlow[];

        /**
        *  A grouped set of locations and messages, if available, that represent code areas that are related to this result.
        */
        relatedLocations: AnnotatedCodeLocation[];

        /**
        *  undefined
        */
        suppressionStates: Result.suppressionStates[];

        /**
        *  The state of a result relative to a baseline of a previous run.
        */
        baselineState: Result.baselineState;

        /**
        *  An array of 'fix' objects, each of which represents a proposed fix to the problem indicated by the result.
        */
        fixes: Fix[];

        /**
        *  Key/value pairs that provide additional information about the result.
        */
        properties: Map<any, any>

    }

    export namespace Result {
        export const enum level {
            notApplicable = "notApplicable",
            pass = "pass",
            note = "note",
            warning = "warning",
            error = "error",
        }
        export const enum suppressionStates {
            suppressedInSource = "suppressedInSource",
            suppressedExternally = "suppressedExternally",
        }
        export const enum baselineState {
            new = "new",
            existing = "existing",
            absent = "absent",
        }
    }

    /**
    * Describes an analysis rule.
    */
    export interface Rule {
        /**
        * [Required] A stable, opaque identifier for the rule.
        */
        id: string;

        /**
        *  A rule identifier that is understandable to an end user.
        */
        name: string;

        /**
        *  A concise description of the rule. Should be a single sentence that is understandable when visible space is limited to a single line of text.
        */
        shortDescription: string;

        /**
        *  A string that describes the rule. Should, as far as possible, provide details sufficient to enable resolution of any problem indicated by the result.
        */
        fullDescription: string;

        /**
        *  A set of name/value pairs with arbitrary names. The value within each name/value pair shall consist of plain text interspersed with placeholders, which can be used to format a message in combination with an arbitrary number of additional string arguments.
        */
        messageFormats: Map<string, string>;

        /**
        *  A value specifying the default severity level of the result.
        */
        defaultLevel: Rule.defaultLevel;

        /**
        *  A URI where the primary documentation for the rule can be found.
        */
        helpUri: string;

        /**
        *  Key/value pairs that provide additional information about the rule.
        */
        properties: Map<any, any>;

    }

    export namespace Rule {
        export const enum defaultLevel {
            note = "note",
            warning = "warning",
            error = "error",
        }
    }

    /**
    * Describes a single run of an analysis tool, and contains the output of that run.
    */
    export interface Run {
        /**
        * [Required] Information about the tool or tool pipeline that generated the results in this run. A run can only contain results produced by a single tool or tool pipeline. A run can aggregate results from multiple log files, as long as context around the tool run (tool command-line arguments and the like) is identical for all aggregated files.
        */
        tool: Tool;

        /**
        *  Describes the runtime environment, including parameterization, of the analysis tool run.
        */
        invocation: Invocation;

        /**
        *  A dictionary, each of whose keys is a URI and each of whose values is an array of file objects representing the location of a single file scanned during the run.
        */
        files: Map<string, File>;

        /**
        *  A dictionary, each of whose keys specifies a logical location such as a namespace, type or function.
        */
        logicalLocations: Map<string, LogicalLocation>;

        /**
        *  The set of results contained in an SARIF log. The results array can be omitted when a run is solely exporting rules metadata. It must be present (but may be empty) in the event that a log file represents an actual scan.
        */
        results: Result[];

        /**
        *  A list of runtime conditions detected by the tool in the course of the analysis.
        */
        toolNotifications: Notification[];

        /**
        *  A list of conditions detected by the tool that are relevant to the tool's configuration.
        */
        configurationNotifications: Notification[];

        /**
        *  A dictionary, each of whose keys is a string and each of whose values is a 'rule' object, that describe all rules associated with an analysis tool or a specific run of an analysis tool.
        */
        rules: Map<string, Rule>;

        /**
        *  An identifier for the run.
        */
        id: string;

        /**
        *  A stable identifier for a run, for example, 'nightly Clang analyzer run'. Multiple runs of the same type can have the same stableId.
        */
        stableId: string;

        /**
        *  A global identifier that allows the run to be correlated with other artifacts produced by a larger automation process.
        */
        automationId: string;

        /**
        *  The 'id' property of a separate (potentially external) SARIF 'run' instance that comprises the baseline that was used to compute result 'baselineState' properties for the run.
        */
        baselineId: string;

        /**
        *  The hardware architecture for which the run was targeted.
        */
        architecture: string;

    }

    /**
    * A call stack that is relevant to a result.
    */
    export interface Stack {
        /**
        *  A message relevant to this call stack.
        */
        message: string;

        /**
        * [Required] An array of stack frames that represent a sequence of calls, rendered in reverse chronological order, that comprise the call stack.
        */
        frames: StackFrame[];

        /**
        *  Key/value pairs that provide additional information about the stack.
        */
        properties: Map<any, any>;

    }

    /**
    * A function call within a stack trace.
    */
    export interface StackFrame {
        /**
        *  A message relevant to this stack frame.
        */
        message: string;

        /**
        *  The uri of the source code file to which this stack frame refers.
        */
        uri: string;

        /**
        *  A string that identifies the conceptual base for the 'uri' property (if it is relative), e.g.,'$(SolutionDir)' or '%SRCROOT%'.
        */
        uriBaseId: string;

        /**
        *  The line of the location to which this stack frame refers.
        */
        line: number;

        /**
        *  The line of the location to which this stack frame refers.
        */
        column: number;

        /**
        *  The name of the module that contains the code of this stack frame.
        */
        module: string;

        /**
        *  The thread identifier of the stack frame.
        */
        threadId: number;

        /**
        * [Required] The fully qualified name of the method or function that is executing.
        */
        fullyQualifiedLogicalName: string;

        /**
        *  A key used to retrieve the stack frame logicalLocation from the logicalLocations dictionary, when the 'fullyQualifiedLogicalName' is not unique.
        */
        logicalLocationKey: string;

        /**
        *  The address of the method or function that is executing.
        */
        address: number;

        /**
        *  The offset from the method or function that is executing.
        */
        offset: number;

        /**
        *  The parameters of the call that is executing.
        */
        parameters: string[];

        /**
        *  Key/value pairs that provide additional information about the stack frame.
        */
        properties: Map<any, any>;

    }

    /**
    * The analysis tool that was run.
    */
    export interface Tool {
        /**
        * [Required] The name of the tool.
        */
        name: string;

        /**
        *  The name of the tool along with its version and any other useful identifying information, such as its locale.
        */
        fullName: string;

        /**
        *  The tool version, in whatever format the tool natively provides.
        */
        version: string;

        /**
        *  The tool version in the format specified by Semantic Versioning 2.0.
        */
        semanticVersion: string;

        /**
        *  The binary version of the tool's primary executable file (for operating systems such as Windows that provide that information).
        */
        fileVersion: string;

        /**
        *  A version that uniquely identifies the SARIF logging component that generated this file, if it is versioned separately from the tool.
        */
        sarifLoggerVersion: string;

        /**
        *  The tool language (expressed as an ISO 649 two-letter lowercase culture code) and region (expressed as an ISO 3166 two-letter uppercase subculture code associated with a country or region).
        */
        language: string;

        /**
        *  Key/value pairs that provide additional information about the tool.
        */
        properties: Map<any, any>;

    }

}