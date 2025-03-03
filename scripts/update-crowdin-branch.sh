#!/bin/bash
# Simple script to update the crowdin branch

CROWDIN_BRANCH=i18n/crowdin

git branch -D $CROWDIN_BRANCH
git pull &&
  git checkout $CROWDIN_BRANCH &&
  git merge -m "Merge branch 'main' into i18n/crowdin" -Xours main &&
  npm run build:langs &&
  npm run langs:update-progress &&
  git add . &&
  git status &&
  echo "If everything looks ok, commit and push the changes by running:" &&
  echo "git commit -m 'i18n: Update locale files'" &&
  echo "git push origin $CROWDIN_BRANCH"
