# Contributing to Chocola

Chocola is a new and sweeter way to build your web apps. The traditional web stack with the superpowers of modern web dev.

The [Open Source Guides](https://opensource.guide/) website has a collection of resources for individuals, communities, and companies. These resources help people who want to learn how to run and contribute to open source projects. Contributors and people new to open source alike will find the following guides especially useful:

- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Building Welcoming Communities](https://opensource.guide/building-community/)

## Get involved

There are many ways to contribute to Chocola, and many of them do not involve writing any code. Here are a few ideas to get started:

- Simply start using Chocola. Go through the [Getting Started](https://github.com/chocolajs/chocola/blob/main/documentation/01-introduction/02-getting-started.md) guide. Does everything work as expected? If not, we're always looking for improvements. Let us know by [opening an issue](#reporting-new-issues).
- Look through the [open issues](https://github.com/chocolajs/chocola/issues). A good starting point would be issues tagged [good first issue](https://github.com/chocolajs/chocola/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22). Provide workarounds, ask for clarification, or suggest labels. Help [triage issues](#triaging-issues-and-pull-requests).
- If you find an issue you would like to fix, [open a pull request](#pull-requests).
- Read through the [documentation](https://github.com/chocolajs/chocola/tree/main/documentation). If you find anything that is confusing or can be improved, you can suggest changes.
- Take a look at the [features requested](https://github.com/chocolajs/chocola/issues?q=state%3Aopen%20label%3A%22feature%20request%22) by others in the community and consider opening a pull request if you see something you want to work on.

Contributions are very welcome.

### Triaging issues and pull requests

One great way you can contribute to the project without writing any code is to help triage issues and pull requests as they come in.

- Ask for more information if you believe the issue does not provide all the details required to solve it.
- Flag issues that are stale or that should be closed.
- Ask for test plans and review code.

## The process

### RFCs

If you'd like to propose an implementation for a large new feature or change then please create an [RFC](https://github.com/chocolajs/rfcs) to discuss it up front.

### Roadmap

When deciding where to contribute, you may wish to take a look at the [roadmap](https://github.com/chocolajs/chocola/blob/main/ROADMAP.md). Chocola development generally works on a single major effort at a time. This has a couple benefits for maintainers. First, it allows to focus and make noticeable progress in an area being proactive rather than reactive. Secondly, it allows to handle related issues and PRs together. By batching issues and PRs together we’re able to ensure implementations and fixes holistically address the set of problems and use cases encountered by users.

### Prioritization

I do my best to review PRs and RFCs as they are sent, but it is difficult to keep up. Help in reviewing PRs, RFCs, and issues is welcomed. If an item aligns with the current priority on the [roadmap](https://github.com/chocolajs/chocola/blob/main/ROADMAP.md), it is more likely to be reviewed quickly. PRs to the most important and active repositories get reviewed more quickly while PRs to smaller inactive repos may sit for a bit before someone periodically come by and review the pending PRs in a batch.

## Bugs

Chocola uses [GitHub issues](https://github.com/chocolajs/chocola/issues) for public bugs. If you would like to report a problem, take a look around and see if someone already opened an issue about it. If you are certain this is a new unreported bug, you can submit a [bug report](#reporting-new-issues).

If you have questions about using Chocola, open a [new discussion](https://github.com/chocolajs/chocola/discussions/new/choose), and the community and I will do our best to answer your questions.

If you see anything you'd like to be implemented, create a [feature request issue](https://github.com/chocolajs/chocola/issues/new?template=feature_request.yml).

### Reporting new issues

When [opening a new issue](https://github.com/chocolajs/chocola/issues/new/choose), always make sure to fill out the issue template. **This step is very important!** Not doing so may result in your issue not being managed in a timely fashion. Don't take this personally if this happens, and feel free to open a new issue once you've gathered all the information required by the template.

- **One issue, one bug:** Please report a single bug per issue.
- **Provide reproduction steps:** List all the steps necessary to reproduce the issue. The person reading your bug report should be able to follow these steps to reproduce your issue with minimal effort.

## Pull requests

### Proposing a change

If you would like to request a new feature or enhancement but are not yet thinking about opening a pull request, you can also file an issue with [feature template](https://github.com/chocolajs/chocola/issues/new?template=feature_request.yml).

If you're only fixing a bug, it's fine to submit a pull request right away, but it's still recommended that you file an issue detailing what you're fixing. This is helpful in case that specific fix is not accepted but wanted to keep track of the issue.

Small pull requests are much easier to review and more likely to get merged.

### Installation

Ensure you have [npm](https://nodejs.org/es/download/current) installed. After cloning the repository, run `npm install`.

### Developing

Once set, run `npm pack` to build a node package and test it in any project.

### Creating a branch

Fork [the repository](https://github.com/chocolajs/chocola) and create your branch from `main`. If you've never sent a GitHub pull request before, you can learn how from [this free video series](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github).

### Testing

A good test plan has the exact commands you ran and their output, provides screenshots or videos if the pull request changes UI.

- If you've changed APIs, update the documentation.

#### Writing tests

All tests are located in the `/tests` folder.

#### Running tests

To run test, run `npm test`.

### Style guide

#### Code conventions

- `snake_case` for internal variable names and methods.
- `camelCase` for public variable names and methods.

### Sending your pull request

Please make sure the to describe your **test plan** in your pull request description when submitting a pull request. Make sure to test your changes

All pull requests should be opened against the `main` branch. Make sure the PR does only one thing, otherwise please split it.

#### Breaking changes

When adding a new breaking change, follow this template in your pull request:

```md
### New breaking change here

- **Who does this affect**:
- **How to migrate**:
- **Why make this breaking change**:
- **Severity (number of people affected x effort)**:
```

## License

By contributing to Chocola, you agree that your contributions will be licensed under its [MIT license](https://github.com/chocolajs/chocola/blob/main/LICENSE).

## Questions

Feel free to ask in [Contributing](https://github.com/chocolajs/chocola/discussions/categories/contributing) on [Discussions](https://github.com/chocolajs/chocola/discussions) if you have questions about processes, how to proceed, etc.