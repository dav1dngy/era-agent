# ERA analysis: hello

- Analysis ID: `analysis-20261013T095143-db49e6`
- Target: `<era-repo>/benchmarks/datasets/native-hello/hello` (mach-o; Mach-O magic cffaedfe)
- Engine: rea-agents 6.4.0
- Status: **succeeded**

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| mach-o-structure | `rea inspect-macho <era-repo>/benchmarks/datasets/native-hello/hello` | succeeded | 4449 ms | `ev_853ce044a228cb2e…` |
| decompile:_greet | `rea function <era-repo>/benchmarks/datasets/native-hello/hello` | succeeded | 5281 ms | `ev_484fe263661aacc8…` |
| decompile:_main | `rea function <era-repo>/benchmarks/datasets/native-hello/hello` | succeeded | 7331 ms | `ev_41261c4bb85bb1ea…` |

## Findings

### Architectures (1)

- `arm64`

### Native call edges (4)

- `_greet->_printf`
- `_greet->_strlen`
- `_main->_printf`
- `_main->_strlen`

### Linked libraries (2)

- `/usr/lib/dyld`
- `/usr/lib/libSystem.B.dylib`

### Exported symbols (3)

- `__mh_execute_header`
- `_greet`
- `_main`

### Decompiled functions (2)

- `_greet`
- `_main`

### Imported symbols (2)

- `_printf`
- `_strlen`

### Referenced strings (2)

- `ERA`
- `Hello, %s! checksum=%u\n`

## Decompiled functions

### _greet @ 0x100000460

Signature: `int _greet(int arg0)`

```c
    r31 = r31 - 0x30;
    var_10 = r20;
    decomp_var_8 = r19;
    saved_fp = r29;
    decomp_var_m8 = r30;
    r19 = arg0;
    r9 = *(int8_t *)arg0;
    if (r9 != 0x0) {
            r10 = r19 + 0x1;
            r8 = 0x1505;
            do {
                    r8 = r8 + r8 * 0x20 + r9;
                    r9 = *(int8_t *)r10;
                    r10 = r10 + 0x1;
            } while (r9 != 0x0);
    }
    else {
            r8 = 0x1505;
    }
    printf("Hello, %s! checksum=%u\n", r19, r8);
    r0 = strlen(r19);
    return r0;
```

### _main @ 0x1000004c4

Signature: `int _main(int arg0, int arg1)`

```c
    r1 = arg1;
    r31 = r31 - 0x30;
    var_10 = r20;
    decomp_var_8 = r19;
    saved_fp = r29;
    decomp_var_m8 = r30;
    if (arg0 >= 0x2) {
            r19 = r1[0x1];
            r9 = *(int8_t *)r19;
            if (r9 != 0x0) {
                    r10 = r19 + 0x1;
                    r8 = 0x1505;
                    do {
                            r8 = r8 + r8 * 0x20 + r9;
                            r9 = *(int8_t *)r10;
                            r10 = r10 + 0x1;
                    } while (r9 != 0x0);
            }
            else {
                    r8 = 0x1505;
            }
    }
    else {
            r19 = "ERA";
            r9 = *(int8_t *)"ERA";
            if (*(int8_t *)"ERA" == 0x0) {
                    r8 = 0x1505;
            }
            else {
                    r19 = "ERA";
                    r10 = "RA";
                    r8 = 0x1505;
                    do {
                            r8 = r8 + r8 * 0x20 + r9;
                            r9 = *(int8_t *)r10;
                            r10 = r10 + 0x1;
                    } while (r9 != 0x0);
            }
    }
    printf("Hello, %s! checksum=%u\n", r19, r8);
    r0 = strlen(r19);
    if (r0 > 0x40) {
            r0 = 0x1;
    }
    return r0;
```

## Coverage and limitations

- `inspect_macho` via macOS native inspection utilities: coverage n/a
  - Imports and exports combine dyld_info and nm; stripped or toolchain-hidden symbols may be absent.
  - vtool output is retained as provenance but only otool build metadata is normalized.
- `analyze_function` via Hopper Disassembler: coverage n/a
  - Results depend on Hopper's completed static analysis.
  - String values cover native typed objects. Hopper may split long literals into adjacent unterminated fragments; string searches match each object independently.
  - Undecodable typed objects retain native display text with an explicit decoding unknown; these values do not establish decoded source literals.
  - Reported string encodings are inferred from typed bytes and native display; the original source's intended encoding is unknown.
  - Native CallReference classifications are observed where available; detailed reference flags remain unknown.
  - Hopper's public Python API does not expose equivalent external or thunk classification in this dossier.
  - Native calls without resolved target addresses are not represented as edges; enumeration beyond reported CallReference objects is unknown.
  - Pseudocode and assembly are provider-specific representations, not original source.
- `analyze_function` via Hopper Disassembler: coverage n/a
  - Results depend on Hopper's completed static analysis.
  - String values cover native typed objects. Hopper may split long literals into adjacent unterminated fragments; string searches match each object independently.
  - Undecodable typed objects retain native display text with an explicit decoding unknown; these values do not establish decoded source literals.
  - Reported string encodings are inferred from typed bytes and native display; the original source's intended encoding is unknown.
  - Native CallReference classifications are observed where available; detailed reference flags remain unknown.
  - Hopper's public Python API does not expose equivalent external or thunk classification in this dossier.
  - Native calls without resolved target addresses are not represented as edges; enumeration beyond reported CallReference objects is unknown.
  - Pseudocode and assembly are provider-specific representations, not original source.

_Static findings describe the analyzed artifact; they do not prove runtime execution unless a process capture is listed above._
