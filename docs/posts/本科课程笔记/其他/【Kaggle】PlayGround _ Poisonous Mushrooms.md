---
title: "【Kaggle】PlayGround | Poisonous Mushrooms"
date: 2024-11-24 :57
tags:
- 其他
category: 本科课程笔记
order: 30
---

# 【Kaggle】PlayGround | Poisonous Mushrooms

## 前言
记录 + 云保存 + 重新过一遍代码。

竞赛地址：[Binary Prediction of Poisonous Mushrooms | Kaggle](https://www.kaggle.com/competitions/playground-series-s4e8)

形式为 jupyter notebook

该训练尝试完成一个二分类的任务，下面是我在本项目中希望完成的部分：
 1. 使用`Pipeline`完成`EDA`
 2. 使用`LGBM` / `XGBoost` 完成二分类的任务
 3. 使用`optuna` 尝试几次微调。

## 引入库
```
# 基础库
import pandas as pd
import numpy as np
from scipy import stats
import random
import warnings

# 绘制图表
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import seaborn as sns
import plotly.graph_objects as go
import plotly.express as px
import squarify
%matplotlib inline

# 深度学习库
from category_encoders import TargetEncoder
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OrdinalEncoder, FunctionTransformer
from sklearn.model_selection import train_test_split, GridSearchCV, cross_val_score, StratifiedKFold
from sklearn.ensemble import IsolationForest
from xgboost import XGBClassifier, XGBRegressor
from catboost import CatBoostClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import StackingClassifier
from lightgbm import LGBMRegressor, LGBMClassifier, early_stopping, log_evaluation

# 系统库
import gc
import os

# 设置随机种子和忽略警告等通用配置
rs = 42
warnings.filterwarnings("ignore")

# 设置Seaborn颜色调色板
colors= ['#1c76b6', '#a7dae9', '#eb6a20', '#f59d3d', '#677fa0', '#d6e4ed', '#f7e9e5']
sns.set_palette(colors)
```
```
!pip install dython
```
```
import os
for dirname, _, filenames in os.walk('/kaggle/input'):
    for filename in filenames:
        print(os.path.join(dirname, filename))
```
## EDA
### load data
```
df_train = pd.read_csv("/kaggle/input/playground-series-s4e8/train.csv")
df_test = pd.read_csv("/kaggle/input/playground-series-s4e8/test.csv")
df_sub = pd.read_csv("/kaggle/input/playground-series-s4e8/sample_submission.csv")
```
```
df_train = df_train.drop(columns=['id'])
df_test = df_test.drop(columns=['id'])
```
### describe data
```
def describeData(df,name):
    if name:
        print(f"{name}的基本信息如下:")
    print("#"*50)
    print("前10条信息:")
    print(df.head(10))
    print("#"*50)
    print("基本类型信息：")
    print(df.info())
    print("#"*50)
    print("缺失值信息：")
    print(df.isnull().sum())
    print("#"*50)
    print("值域信息：")
    print(df.nunique())
    print("#"*50)
    duplicates = df.duplicated()
    print(f"重复的行数有{duplicates.sum()}行")
    print("#"*50)
    print()
    print()
```
```
describeData(df_train,"训练集")
```
```
describeData(df_test,"测试集")
```
从值域范围来看，**独热码**是不可能完成的了，太大范围了，数据量遭不住。

```
print("查看缺失范围")
missing_train = df_train.isna().mean() * 100
missing_test = df_test.isna().mean() * 100

print("Columns in df_train with more than 10% missing values:")
print(missing_train[missing_train > 0])

print("\nColumns in df_test with more than 10% missing values:")
print(missing_test[missing_test > 0])
```
```
# 绘制频数图
cat_cols = df_train.select_dtypes(include='object').columns.tolist()
palette = {'e': sns.color_palette("Set1")[1], 'p': sns.color_palette("Set1")[0]}

fig, axes = plt.subplots(4, 5, figsize=(20, 10))
axes = axes.flatten()
for i, col in enumerate(cat_cols):
    sns.countplot(data=df_train, x=col, hue="class", ax=axes[i], palette=palette)
    axes[i].set_title(f'{col} distribution')
    axes[i].set_ylabel('')
    axes[i].set_xlabel('')

plt.tight_layout()
plt.show()
```
```
from dython.nominal import associations

# 绘制热力图
associations_df = associations(df_train, nominal_columns='all', plot=False)
corr_matrix = associations_df['corr']
plt.figure(figsize=(20, 8))
plt.gcf().set_facecolor('#FFFDD0')
sns.heatmap(corr_matrix, annot=True, fmt='.2f', cmap='coolwarm', linewidths=0.5)
plt.title('Correlation Matrix including Categorical Features')
plt.show()
```
### new features
```
# 新增特征
# 把热力图中>=0.2的都进行两两组合
# 本来是是想两两组合，n^2的复杂度，内存遭不住，就只对缺失值较少的color进行组合

# Redefine columns for preprocessing after feature engineering
numerical_columns = df_train.select_dtypes(include=['float64', 'int64']).columns.tolist()
categorical_columns = df_train.select_dtypes(include=['object']).columns.tolist()

color_columns = ['cap-color','gill-color','stem-color']

interaction_features = []

for f1 in numerical_columns:
    for f2 in numerical_columns:
        interaction_features.append((f1,f2))

for f1 in color_columns:
    for f2 in color_columns:
        if f1 != f2:
            interaction_features.append((f1,f2))

print(f"新增特征为:{len(interaction_features)}")
```
```
def new_features(df):
    for col1, col2 in interaction_features:
        feature_name = f"{col1}_{col2}"
        if col1 in numerical_columns and col2 in numerical_columns:
            df[feature_name] = df[col1] * df[col2]
            continue
        if col1 != col2 and col1 in categorical_columns and col2 in categorical_columns:
            df[feature_name] = df[col1].astype('str') + df[col2].astype('str')
    return df

gc.collect()
```
```
df_train = new_features(df_train)
df_test = new_features(df_test)
```
```
# 取消注释查看数据
# describeData(df_train,name="新增特征后的训练集")
# describeData(df_test,name="新增特征后的测试集")
```
### pipeline
impute | ordinary encode

```
X_train = df_train.drop('class', axis=1)
y_train = df_train['class']
```
```
# 类别转换
class_map = {'e':0,'p':1}
y_train = y_train.map(class_map)
```
```
# Redefine columns for preprocessing after feature engineering
numerical_columns = X_train.select_dtypes(include=['float64', 'int64']).columns.tolist()
categorical_columns = X_train.select_dtypes(include=['object']).columns.tolist()

# Define preprocessing pipelines
numerical_pipeline = Pipeline(steps=[
    ('imputer', SimpleImputer(strategy='median')),
    ('scaler', StandardScaler()),
    ('convert_to_float32', FunctionTransformer(lambda x: x.astype(np.float32)))
])

categorical_pipeline = Pipeline(steps=[
    ('imputer', SimpleImputer(strategy='constant', fill_value='missing')),
    ('ordinal', OrdinalEncoder(dtype=np.int32, handle_unknown='use_encoded_value', unknown_value=-1))
])

# Combine the numerical and categorical pipelines
preprocessor = ColumnTransformer(
    transformers=[
        ('num', numerical_pipeline, numerical_columns),
        ('cat', categorical_pipeline, categorical_columns)
    ]
)

# Apply the transformations to the training and test sets
X_train_preprocessed = preprocessor.fit_transform(X_train)
X_test_preprocessed = preprocessor.transform(df_test)
```
```
# 准备模型数据
X = X_train_preprocessed
test = X_test_preprocessed
y = y_train
```
##  建立模型
### LightGBM
```
from sklearn.metrics import accuracy_score

skfold = StratifiedKFold(n_splits=10, shuffle=True, random_state=101)

oof_preds = []
oof_accs = []

# 这是别人的参数
# clf = LGBMClassifier(objective='binary', metric='binary_error',num_leaves=81,
    # learning_rate=0.1, n_estimators=550, max_depth= 9, random_state=21)

for fold, (train_idx, test_idx) in enumerate(skfold.split(np.zeros(X.shape[0]),y)):
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]

    # 别人的参数
    lgb_clf = LGBMClassifier(objective='binary', metric='binary_error',num_leaves=81,
    learning_rate=0.1, n_estimators=550, max_depth= 9, random_state=21)

    lgb_clf = lgb_clf.fit(X_train, y_train,
                          eval_set=[(X_test, y_test)],
                          callbacks=[early_stopping(100)])

    y_pred = lgb_clf.predict(X_test, num_iteration=lgb_clf.best_iteration_)
    acc = accuracy_score(y_test, y_pred)
    oof_accs.append(acc)
    oof_preds.append(lgb_clf.predict_proba(test, num_iteration=lgb_clf.best_iteration_)[:,1])
    print(f"\nFold {fold+1}--> Accuracy Score: {acc:.6f}\n")

    del X_train, y_train, X_test, y_test, lgb_clf
    gc.collect()

acc_mean = np.mean(oof_accs)
acc_std = np.std(oof_accs)
print(f"\n\nAverage Fold Accuracy Score: {acc_mean:.6f} \xB1 {acc_std:.6f}\n\n")
```
```
r_class_map = {0:'e',1:'p'}
test_pred = (np.mean(oof_preds,axis=0)>0.5).astype(int)
df_sub['class'] = test_pred
df_sub['class'] = df_sub['class'].map(r_class_map)
df_sub.to_csv('submission.csv', index = False)
pd.read_csv('submission.csv')
```
```
df_sub['class'].hist()
```
### XGBoost
```
from sklearn.metrics import matthews_corrcoef
from xgboost import XGBClassifier

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
model = XGBClassifier(
    alpha=0.1,
    subsample=0.8,
    colsample_bytree=0.6,
    objective='binary:logistic',
    max_depth=14,
    min_child_weight=7,
    gamma=1e-6,
    #random_state=42,
    n_estimators=100
    )

XGB = model.fit(
    X_train,
    y_train,
    eval_set=[(X_test, y_test)],
    eval_metric='auc',
    early_stopping_rounds=15,
    verbose = False)

y_pred = XGB.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"准确率为：{acc}")

test_pred = XGB.predict_proba(test)[:,1]
```
```
r_class_map = {0:'e',1:'p'}
test_pred = (test_pred>0.5).astype(int)
df_sub['class'] = test_pred
df_sub['class'] = df_sub['class'].map(r_class_map)
df_sub.to_csv('submission.csv', index = False)
pd.read_csv('submission.csv')
```
```
df_sub['class'].hist()
```
