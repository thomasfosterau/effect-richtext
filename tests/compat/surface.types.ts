// Compile-time check that every compat module declares the public API of the
// prosemirror-* package it replaces: every export, and every static and
// instance member of each exported class. A name in place of `never` is a
// known gap.
import type * as model from "@thomasfosterau/effect-richtext/compat/model"
import type * as PmModel from "prosemirror-model"
import type * as transform from "@thomasfosterau/effect-richtext/compat/transform"
import type * as PmTransform from "prosemirror-transform"
import type * as state from "@thomasfosterau/effect-richtext/compat/state"
import type * as PmState from "prosemirror-state"
import type * as view from "@thomasfosterau/effect-richtext/compat/view"
import type * as PmView from "prosemirror-view"
import type * as keymap from "@thomasfosterau/effect-richtext/compat/keymap"
import type * as PmKeymap from "prosemirror-keymap"
import type * as commands from "@thomasfosterau/effect-richtext/compat/commands"
import type * as PmCommands from "prosemirror-commands"
import type * as schemaBasic from "@thomasfosterau/effect-richtext/compat/schema-basic"
import type * as PmSchemaBasic from "prosemirror-schema-basic"
import type * as schemaList from "@thomasfosterau/effect-richtext/compat/schema-list"
import type * as PmSchemaList from "prosemirror-schema-list"
import type * as testBuilder from "@thomasfosterau/effect-richtext/compat/test-builder"
import type * as PmTestBuilder from "prosemirror-test-builder"
import type { Equals, Expect } from "../utils/types.ts"

/** The public names of `Real` that `Compat` lacks. */
type Missing<Real, Compat> = Exclude<keyof Real, keyof Compat>

// prosemirror-model
type _model = Expect<Equals<Missing<typeof PmModel, typeof model>, never>>
type _modelContentMatchStatic = Expect<Equals<Missing<typeof PmModel.ContentMatch, typeof model.ContentMatch>, never>>
type _modelContentMatch = Expect<Equals<Missing<PmModel.ContentMatch, model.ContentMatch>, never>>
type _modelDOMParserStatic = Expect<Equals<Missing<typeof PmModel.DOMParser, typeof model.DOMParser>, never>>
type _modelDOMParser = Expect<Equals<Missing<PmModel.DOMParser, model.DOMParser>, never>>
type _modelDOMSerializerStatic = Expect<
  Equals<Missing<typeof PmModel.DOMSerializer, typeof model.DOMSerializer>, never>
>
type _modelDOMSerializer = Expect<Equals<Missing<PmModel.DOMSerializer, model.DOMSerializer>, never>>
type _modelFragmentStatic = Expect<Equals<Missing<typeof PmModel.Fragment, typeof model.Fragment>, never>>
type _modelFragment = Expect<Equals<Missing<PmModel.Fragment, model.Fragment>, never>>
type _modelMarkStatic = Expect<Equals<Missing<typeof PmModel.Mark, typeof model.Mark>, never>>
type _modelMark = Expect<Equals<Missing<PmModel.Mark, model.Mark>, never>>
type _modelMarkTypeStatic = Expect<Equals<Missing<typeof PmModel.MarkType, typeof model.MarkType>, never>>
type _modelMarkType = Expect<Equals<Missing<PmModel.MarkType, model.MarkType>, never>>
type _modelNodeStatic = Expect<Equals<Missing<typeof PmModel.Node, typeof model.Node>, never>>
type _modelNode = Expect<Equals<Missing<PmModel.Node, model.Node>, never>>
type _modelNodeRangeStatic = Expect<Equals<Missing<typeof PmModel.NodeRange, typeof model.NodeRange>, never>>
type _modelNodeRange = Expect<Equals<Missing<PmModel.NodeRange, model.NodeRange>, never>>
type _modelNodeTypeStatic = Expect<Equals<Missing<typeof PmModel.NodeType, typeof model.NodeType>, never>>
type _modelNodeType = Expect<Equals<Missing<PmModel.NodeType, model.NodeType>, never>>
type _modelReplaceErrorStatic = Expect<Equals<Missing<typeof PmModel.ReplaceError, typeof model.ReplaceError>, never>>
type _modelReplaceError = Expect<Equals<Missing<PmModel.ReplaceError, model.ReplaceError>, never>>
type _modelResolvedPosStatic = Expect<Equals<Missing<typeof PmModel.ResolvedPos, typeof model.ResolvedPos>, never>>
type _modelResolvedPos = Expect<Equals<Missing<PmModel.ResolvedPos, model.ResolvedPos>, never>>
type _modelSchemaStatic = Expect<Equals<Missing<typeof PmModel.Schema, typeof model.Schema>, never>>
type _modelSchema = Expect<Equals<Missing<PmModel.Schema, model.Schema>, never>>
type _modelSliceStatic = Expect<Equals<Missing<typeof PmModel.Slice, typeof model.Slice>, never>>
type _modelSlice = Expect<Equals<Missing<PmModel.Slice, model.Slice>, never>>

// prosemirror-transform
type _transform = Expect<Equals<Missing<typeof PmTransform, typeof transform>, never>>
type _transformAddMarkStepStatic = Expect<
  Equals<Missing<typeof PmTransform.AddMarkStep, typeof transform.AddMarkStep>, never>
>
type _transformAddMarkStep = Expect<Equals<Missing<PmTransform.AddMarkStep, transform.AddMarkStep>, never>>
type _transformAddNodeMarkStepStatic = Expect<
  Equals<Missing<typeof PmTransform.AddNodeMarkStep, typeof transform.AddNodeMarkStep>, never>
>
type _transformAddNodeMarkStep = Expect<Equals<Missing<PmTransform.AddNodeMarkStep, transform.AddNodeMarkStep>, never>>
type _transformAttrStepStatic = Expect<Equals<Missing<typeof PmTransform.AttrStep, typeof transform.AttrStep>, never>>
type _transformAttrStep = Expect<Equals<Missing<PmTransform.AttrStep, transform.AttrStep>, never>>
type _transformDocAttrStepStatic = Expect<
  Equals<Missing<typeof PmTransform.DocAttrStep, typeof transform.DocAttrStep>, never>
>
type _transformDocAttrStep = Expect<Equals<Missing<PmTransform.DocAttrStep, transform.DocAttrStep>, never>>
type _transformMapResultStatic = Expect<
  Equals<Missing<typeof PmTransform.MapResult, typeof transform.MapResult>, never>
>
type _transformMapResult = Expect<Equals<Missing<PmTransform.MapResult, transform.MapResult>, never>>
type _transformMappingStatic = Expect<Equals<Missing<typeof PmTransform.Mapping, typeof transform.Mapping>, never>>
type _transformMapping = Expect<Equals<Missing<PmTransform.Mapping, transform.Mapping>, never>>
type _transformRemoveMarkStepStatic = Expect<
  Equals<Missing<typeof PmTransform.RemoveMarkStep, typeof transform.RemoveMarkStep>, never>
>
type _transformRemoveMarkStep = Expect<Equals<Missing<PmTransform.RemoveMarkStep, transform.RemoveMarkStep>, never>>
type _transformRemoveNodeMarkStepStatic = Expect<
  Equals<Missing<typeof PmTransform.RemoveNodeMarkStep, typeof transform.RemoveNodeMarkStep>, never>
>
type _transformRemoveNodeMarkStep = Expect<
  Equals<Missing<PmTransform.RemoveNodeMarkStep, transform.RemoveNodeMarkStep>, never>
>
type _transformReplaceAroundStepStatic = Expect<
  Equals<Missing<typeof PmTransform.ReplaceAroundStep, typeof transform.ReplaceAroundStep>, never>
>
type _transformReplaceAroundStep = Expect<
  Equals<Missing<PmTransform.ReplaceAroundStep, transform.ReplaceAroundStep>, never>
>
type _transformReplaceStepStatic = Expect<
  Equals<Missing<typeof PmTransform.ReplaceStep, typeof transform.ReplaceStep>, never>
>
type _transformReplaceStep = Expect<Equals<Missing<PmTransform.ReplaceStep, transform.ReplaceStep>, never>>
type _transformStepStatic = Expect<Equals<Missing<typeof PmTransform.Step, typeof transform.Step>, never>>
type _transformStep = Expect<Equals<Missing<PmTransform.Step, transform.Step>, never>>
type _transformStepMapStatic = Expect<Equals<Missing<typeof PmTransform.StepMap, typeof transform.StepMap>, never>>
type _transformStepMap = Expect<Equals<Missing<PmTransform.StepMap, transform.StepMap>, never>>
type _transformStepResultStatic = Expect<
  Equals<Missing<typeof PmTransform.StepResult, typeof transform.StepResult>, never>
>
type _transformStepResult = Expect<Equals<Missing<PmTransform.StepResult, transform.StepResult>, never>>
type _transformTransformStatic = Expect<
  Equals<Missing<typeof PmTransform.Transform, typeof transform.Transform>, never>
>
type _transformTransform = Expect<Equals<Missing<PmTransform.Transform, transform.Transform>, never>>

// prosemirror-state
type _state = Expect<Equals<Missing<typeof PmState, typeof state>, never>>
type _stateAllSelectionStatic = Expect<Equals<Missing<typeof PmState.AllSelection, typeof state.AllSelection>, never>>
type _stateAllSelection = Expect<Equals<Missing<PmState.AllSelection, state.AllSelection>, never>>
type _stateEditorStateStatic = Expect<Equals<Missing<typeof PmState.EditorState, typeof state.EditorState>, never>>
type _stateEditorState = Expect<Equals<Missing<PmState.EditorState, state.EditorState>, never>>
type _stateNodeSelectionStatic = Expect<
  Equals<Missing<typeof PmState.NodeSelection, typeof state.NodeSelection>, never>
>
type _stateNodeSelection = Expect<Equals<Missing<PmState.NodeSelection, state.NodeSelection>, never>>
type _statePluginStatic = Expect<Equals<Missing<typeof PmState.Plugin, typeof state.Plugin>, never>>
type _statePlugin = Expect<Equals<Missing<PmState.Plugin, state.Plugin>, never>>
type _statePluginKeyStatic = Expect<Equals<Missing<typeof PmState.PluginKey, typeof state.PluginKey>, never>>
type _statePluginKey = Expect<Equals<Missing<PmState.PluginKey, state.PluginKey>, never>>
type _stateSelectionStatic = Expect<Equals<Missing<typeof PmState.Selection, typeof state.Selection>, never>>
type _stateSelection = Expect<Equals<Missing<PmState.Selection, state.Selection>, never>>
type _stateSelectionRangeStatic = Expect<
  Equals<Missing<typeof PmState.SelectionRange, typeof state.SelectionRange>, never>
>
type _stateSelectionRange = Expect<Equals<Missing<PmState.SelectionRange, state.SelectionRange>, never>>
type _stateTextSelectionStatic = Expect<
  Equals<Missing<typeof PmState.TextSelection, typeof state.TextSelection>, never>
>
type _stateTextSelection = Expect<Equals<Missing<PmState.TextSelection, state.TextSelection>, never>>
type _stateTransactionStatic = Expect<Equals<Missing<typeof PmState.Transaction, typeof state.Transaction>, never>>
type _stateTransaction = Expect<Equals<Missing<PmState.Transaction, state.Transaction>, never>>

// prosemirror-view
type _view = Expect<Equals<Missing<typeof PmView, typeof view>, never>>
type _viewDecorationStatic = Expect<Equals<Missing<typeof PmView.Decoration, typeof view.Decoration>, never>>
type _viewDecoration = Expect<Equals<Missing<PmView.Decoration, view.Decoration>, never>>
type _viewDecorationSetStatic = Expect<Equals<Missing<typeof PmView.DecorationSet, typeof view.DecorationSet>, never>>
type _viewDecorationSet = Expect<Equals<Missing<PmView.DecorationSet, view.DecorationSet>, never>>
type _viewEditorViewStatic = Expect<Equals<Missing<typeof PmView.EditorView, typeof view.EditorView>, never>>
type _viewEditorView = Expect<Equals<Missing<PmView.EditorView, view.EditorView>, never>>

// prosemirror-keymap
type _keymap = Expect<Equals<Missing<typeof PmKeymap, typeof keymap>, never>>

// prosemirror-commands
type _commands = Expect<Equals<Missing<typeof PmCommands, typeof commands>, never>>

// prosemirror-schema-basic
type _schemaBasic = Expect<Equals<Missing<typeof PmSchemaBasic, typeof schemaBasic>, never>>

// prosemirror-schema-list
type _schemaList = Expect<Equals<Missing<typeof PmSchemaList, typeof schemaList>, never>>

// prosemirror-test-builder
type _testBuilder = Expect<Equals<Missing<typeof PmTestBuilder, typeof testBuilder>, never>>
