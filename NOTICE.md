# Third-party notices

## Reverse Engineer Anything (REA)

ERA integrates and executes the original **Reverse Engineer Anything** engine
(npm package `rea-agents`, source <https://github.com/morluto/rea>) as its
reverse-engineering core. ERA does not copy, modify or vendor REA source code;
it declares `rea-agents@6.4.0` as a dependency and invokes its CLI.

REA is distributed under the MIT License:

```
MIT License

Copyright (c) 2026 morluto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

REA's own third-party components are listed in its package
(`node_modules/rea-agents/licenses/` and `third_party/`).

Evidence files under `tests/fixtures/evidence/` and `experiments/` are outputs
produced by running REA 6.4.0 against ERA's own authored fixtures and ERA itself.
