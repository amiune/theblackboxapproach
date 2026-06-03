# BlackBoxApproach Projects

Each app or product created with BlackBoxApproach belongs in its own directory:

```text
projects/
  my-app/
    .git/
    blackboxes/
    src/
    tests/
```

The macOS app can write a new project from a ChatGPT response. For a new app,
the response should include a project path such as `projects/my-app`; the app
will create that directory, copy the blank `blackboxes/` template when needed,
initialize `.git`, write the returned files, and load that project.
