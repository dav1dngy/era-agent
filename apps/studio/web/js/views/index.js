import { html } from '../html.js';
import { Home } from './home.js';
import { ProjectsView, ProjectView } from './projects.js';
import { SettingsView } from './settings.js';
import { AgentsView } from './agents.js';
import { AnalysisView } from './analysis.js';
import { ImprovementView } from './improvement.js';
import { LabView } from './lab.js';
import { ToolsView } from './tools.js';
import { WorkbenchView } from './workbench.js';
import { DocsView } from './docs.js';

const Projects = ({ route }) => (route.path[1] ? html`<${ProjectView} route=${route} />` : html`<${ProjectsView} />`);
export const Views = { home: Home, projects: Projects, settings: SettingsView, agents: AgentsView, analysis: AnalysisView, improvement: ImprovementView, lab: LabView, tools: ToolsView, workbench: WorkbenchView, docs: DocsView };
