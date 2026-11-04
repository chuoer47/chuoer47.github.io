---
title: "【Kaggle】 PlayGround | Regression of Used Car Prices"
date: 2024-11-29 :39
tags:
- Python 与数据分析
category: 本科课程笔记
order: 5
---

# 【Kaggle】 PlayGround | Regression of Used Car Prices

## 前记
比赛链接：[Regression of Used Car Prices | Kaggle](https://www.kaggle.com/competitions/playground-series-s4e9/overview)

Your Goal: The goal of this competition is to predict the price of used cars based on various attributes.

Root Mean Squared Error (RMSE)
 Submissions are scored on the root mean squared error.

 2024.11.27 开始本次工作，本次`notebook`希望学习如下内容：

 1. 学会建立合理的`baseline`评估模型；之前都是微调，然后参考别人的结果来对自己的模型进行比较，这样子的比较不科学不严谨，希望能自己确立无调参的各类模型的`baseline`
 2. 完成预估任务，之前任务是二分类/概率估计，本次任务是估计房价，不知道会带来什么全新的挑战。
 3. 再熟悉熟悉各类模型的代码

 2024.11.27 初步完成，特征工程 | baseline 搭建 | pipeline 搭建

 现在前期工作完成比较通畅，后续optuna微调尝试。

 2024.11.28 来吧，尝试微调代码咯，目标，调到70000一下就算胜利

 (发现前面调到70000写的好傻，下面是教训)

 教训一：对于`RMSE`指标，不能只看private score的，还要看public score，我只看private发现我怎么都降不下来，但是，20%的数据和80%的数据存在统计学差异，因此一个最好 72000+ ， 一个最好 69000+，差异非常大。这个指标不想 `acc` ， `auc` 指标，可以只看一个。很宝贵的教训！！！！

 教训二：要把一些极端值做噪声处理，尤其是我这种切割数据使用了随机种子，过拟合警告！！！

 教训三：一定要做交叉验证，这种数据交叉验证太重要了。

## Library

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
from sklearn.impute import KNNImputer
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

# optuna微调库
import optuna
from optuna.samplers import TPESampler

# TF-IDF
from sklearn.model_selection import StratifiedKFold
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import LabelEncoder

# 设置随机种子和忽略警告等通用配置
rs = 42
warnings.filterwarnings("ignore")

# 设置Seaborn颜色调色板
colors= ['#1c76b6', '#a7dae9', '#eb6a20', '#f59d3d', '#677fa0', '#d6e4ed', '#f7e9e5']
sns.set_palette(colors)
```
```
# 第一次运行取消注释
!pip install dython
```
```
for dirname, _, filenames in os.walk('/kaggle/input'):
    for filename in filenames:
        print(os.path.join(dirname, filename))
```
##  EDA
### load data
```
df_train = pd.read_csv("/kaggle/input/playground-series-s4e9/train.csv")
df_test = pd.read_csv("/kaggle/input/playground-series-s4e9/test.csv")
df_sub = pd.read_csv("/kaggle/input/playground-series-s4e9/sample_submission.csv")
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
print("查看缺失范围")
missing_train = df_train.isna().mean() * 100
missing_test = df_test.isna().mean() * 100

print("Columns in df_train with more than 10% missing values:")
print(missing_train[missing_train > 0])

print("\nColumns in df_test with more than 10% missing values:")
print(missing_test[missing_test > 0])
```
```
# 绘制柱状图图
objective = "price"
cat_cols = df_train.select_dtypes(include='object').columns.tolist()

fig, axes = plt.subplots(3, 3, figsize=(20, 10))
axes = axes.flatten()
for i, col in enumerate(cat_cols):
    sns.barplot(x=col,y=objective,data=df_train, ax=axes[i], errorbar=None)
    axes[i].set_title(f'avg_price by {col} ')
    axes[i].set_ylabel('')
    axes[i].set_xlabel('')

# plt.tight_layout()
plt.show()
```
```
from dython.nominal import associations

associations_df = associations(df_train, nominal_columns='all', plot=False)
corr_matrix = associations_df['corr']
plt.figure(figsize=(20, 8))
plt.gcf().set_facecolor('#FFFDD0')
sns.heatmap(corr_matrix, annot=True, fmt='.2f', cmap='coolwarm', linewidths=0.5)
plt.title('Correlation Matrix including Categorical Features')
plt.show()
```
总结：

各个属性进行解释：

brand：车辆所属品牌。

model：品牌下的具体型号。

model_year：车辆首次推出或重大改款年份。

milage：已行驶累计里程。

fuel_type：使用的燃料种类。

engine：与发动机相关信息，如排量、类型等。

transmission：变速器类型。

ext_col：外观颜色。

int_col：内饰颜色。

accident：是否发生过事故。

clean_title：车辆产权是否干净，有无相关隐患。

price：车辆售卖价格。

 虽然存在缺失值，但是需要注意一点：`clean_title`的缺失范围大，但是值域只有一个，其实直接做`sampleImputer`即可，其余的可以使用`KNNImpute`。

做一些简单的特征构建即可。

### features building
在特征构建，我希望做到两件事情：

1. 根据TF-IDF，找到稀有的型号，转化为数值
 2. 使用groupby 完成一些统计学的属性，在构建的时候，我发现一个问题，如果使用price属性聚类，可能面临着数据泄露的风险，由于我水平有限，目前还不会处理这种情况，所以该部分暂时搁置。

```
# new features
def new_features(df_train,df_test):
    current_year = 2024
    luxury_brands = ['Mercedes-Benz', 'BMW', 'Audi', 'Lexus', 'Tesla']
    for df in [df_train,df_test]:
        df['model_year_milage'] = df['model_year']*df['milage']
        # 下面是借鉴来的属性，不难得知，这些属性带有浓厚的先验知识
        df['rare_fuel_type'] = df['fuel_type'].apply(lambda x: 0 if x in ['Petrol', 'Diesel'] else 1)
        df['is_automatic'] = df['transmission'].apply(lambda x: 1 if x == 'Automatic' else 0)
        df['has_accident_history'] = df['accident'].apply(lambda x: 1 if x != 'Unknown' and x != 'None' else 0)
        df['color_match'] = df.apply(lambda row: 1 if row['ext_col'] == row['int_col'] else 0, axis=1)
        df['is_luxury_brand'] = df['brand'].apply(lambda x: 1 if x in luxury_brands else 0)
    return df_train,df_test
```
```
df_train,df_test = new_features(df_train,df_test)
```
### TF-IDF

```
def get_vectors(df_train,df_test,col_name):
    vectorizer = TfidfVectorizer(max_features=1000)
    vectors_train = vectorizer.fit_transform(df_train[col_name])
    vectors_test = vectorizer.transform(df_test[col_name])

    svd = TruncatedSVD(3)
    x_pca_train = svd.fit_transform(vectors_train)
    x_pca_test = svd.transform(vectors_test)

    # Convert to DataFrames
    tfidf_df_train = pd.DataFrame(x_pca_train)
    tfidf_df_test = pd.DataFrame(x_pca_test)

    # Naming columns in the new DataFrames
    cols = [(col_name + "_tfidf_" + str(f)) for f in tfidf_df_train.columns.to_list()]
    tfidf_df_train.columns = cols
    tfidf_df_test.columns = cols

    # Reset the index of the DataFrames before concatenation
    df_train = df_train.reset_index(drop=True)
    df_test = df_test.reset_index(drop=True)

    # Concatenate transformed features with original data
    df_train = pd.concat([df_train, tfidf_df_train], axis="columns")
    df_test = pd.concat([df_test, tfidf_df_test], axis="columns")
    return df_train,df_test
```
```
# 对不同列进行 TF-IDF Vectorization 方法处理
# 但是由于缺失值，得先进行简单的填充
tf_IDF_list = ['brand', 'model', 'fuel_type', 'engine','transmission', 'ext_col', 'int_col']
simple_imputer = SimpleImputer(strategy='constant', fill_value='missed')
df_train[tf_IDF_list] = simple_imputer.fit_transform(df_train[tf_IDF_list])
df_test[tf_IDF_list] = simple_imputer.transform(df_test[tf_IDF_list])

for name in tf_IDF_list:
    df_train,df_test = get_vectors(df_train,df_test,name)
```
### 去除噪声数据
(后记：该实现想法非常糟糕。尽管删去了极端数据对于模型的过拟合问题，但是数据总归是波动的，无法避免，保守的模型导致遇到更大的/更小的数据无法很好地适应，导致更大的误差。需要重新思考。)

2024.11.28 有些计算数据会显著影响模型的健壮性，而且会导致很严重的结果。我初步尝试去除一些噪声数据，下面是我的思路：

把极端的价格(两端的计算数据)去除，这样可以防止计算`RMSE`的时候，由于极端数据导致的过拟合现象。

```
# # 使用 IQR异常值检测
# def IQR_clean(df,objective):
#     # 计算四分位距(IQ)
#     Q1 = df[objective].quantile(0.25)
#     Q3 = df[objective].quantile(0.75)
#     IQR = Q3 - Q1

#     # 确定上下界，通常将超出1.5倍IQ范围的值视为异常值
#     lower_bound = Q1 - 1.5 * IQR
#     upper_bound = Q3 + 1.5 * IQR

#     # 根据上下界去除异常值
#     df_cleaned = df[(df[objective] >= lower_bound) & (df[objective] <= upper_bound)]
#     return df_cleaned
```
```
# df_train = IQR_clean(df_train,"price")
```
### Pipeline | 模型数据
```
objective = "price"
X_train = df_train.drop(objective, axis=1)
y_train = df_train[objective]
```
```
numerical_colums = ['model_year', 'milage']
catagotical_colums = ['brand', 'model', 'fuel_type', 'engine','transmission', 'ext_col', 'int_col', 'clean_title','accident']
keep_columns = list(set(X_train.columns) - set(numerical_colums) - set(catagotical_colums))
keep_columns = list(set(keep_columns))

numerical_pipeline = Pipeline(steps=[
    ('impute',KNNImputer(n_neighbors=25)),
    ('scaler',StandardScaler()),
    ('convert_to_float32',FunctionTransformer(lambda x:x.astype(np.float64)))
])

catagotical_pipeline = Pipeline(steps=[
    ('impute',SimpleImputer(strategy='constant', fill_value='missed')),
    ('ord_encode',OrdinalEncoder(dtype=np.int32,handle_unknown='use_encoded_value',unknown_value=-1))
])

keep_pipeline = Pipeline(steps=[
    ('impute',KNNImputer(n_neighbors=25))
])

preprocessor = ColumnTransformer(transformers=[
    ('cat',catagotical_pipeline,catagotical_colums),
    ('num',numerical_pipeline,numerical_colums),
    ('keep',keep_pipeline,keep_columns)
])
```
```
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
## Model Baseline
建立一个baseline的一些方法，这是之前没有过的任务。

封装尝试一下

### 建立评价指标
`make_scorer`学习到了

```
from sklearn.metrics import mean_squared_error
from sklearn.metrics import make_scorer
from sklearn.model_selection import cross_val_score
from sklearn.model_selection import KFold

def rmse(y_true, y_pred):
    return np.sqrt(mean_squared_error(y_true, y_pred))
rmse_scorer = make_scorer(rmse)
```
```
from xgboost import XGBRegressor
from catboost import CatBoostRegressor

def baseline_report(X,y,scoring):
    # 使用五折验证
    Baseline = [LGBMRegressor(verbose=0),XGBRegressor(verbose=0),CatBoostRegressor(verbose=0)]
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    for estimator in Baseline:
        model_name = estimator.__class__.__name__
        print("="*80)
        print("****model report:")
        print(f"    Model: {model_name}")
        rmse = cross_val_score(estimator,X,y,cv=kf,scoring=scoring)
        print(f"rmse:{rmse}")
        print(f"arg:{np.mean(rmse)}")
```
```
baseline_report(X,y,rmse_scorer)
```

 ================================================================================
****model report:
    Model: LGBMRegressor
rmse:[67935.25825724 69102.41891405 74518.95588857 76674.77726307
 76531.68701807]
arg:72952.61946819854
================================================================================
****model report:
    Model: XGBRegressor
rmse:[71627.32043891 73864.48136721 77738.11526574 78729.20299475
 80434.44849068]
arg:76478.71371145961
================================================================================
****model report:
    Model: CatBoostRegressor
rmse:[68646.92428241 70244.31233474 74972.61602158 76814.2032692
 77681.09927265]
arg:73671.83103611504

## hyperparameter tuning
### Optuna | XGBRegressor
```
# X_train, X_test, y_train, y_test = train_test_split(X, y, train_size=0.8, shuffle=True, stratify=y, random_state=42)
# def objective(trial):
#     param = {
#         'tree_method':"hist",
#         'device':'cuda',
#         'objective':'reg:squarederror',
#         'use_label_encoder':False,
#         'random_state':42,
#         'verboseity':0,
#         'n_estimators':trial.suggest_int('n_estimators',100,3000),
#         'max_depth':trial.suggest_int('max_depth',3,20),
#         'learning_rate': trial.suggest_float('learning_rate', 1e-2, 0.5),
#         'subsample': trial.suggest_float('subsample', 0.6, 0.8),
#         'colsample_bytree': trial.suggest_float('colsample_bytree', 0.5, 1.0),
#         'gamma': trial.suggest_float('gamma', 0, 0.5),
#         'max_delta_step' : trial.suggest_int('max_delta_step', 0, 5),
#     }

#     model = XGBRegressor(**param)
#     model.fit(X_train, y_train, eval_set=[(X_test, y_test)],
#               verbose=0,
#               eval_metric='rmse')
#     y_pred = model.predict(X_test)
#     rmse = np.sqrt(mean_squared_error(y_test,y_pred))
#     return rmse

# study = optuna.create_study(direction='minimize',sampler=TPESampler(),study_name="XGBoostRegressor")
# study.optimize(objective,n_trials=50)
# best_params = study.best_params
```

  第一次炼丹(n_trail=20)，居然还没baseline好？

 Trial 18 finished with value: 74476.28568178075 and parameters: {'n_estimators': 616, 'max_depth': 5, 'learning_rate': 0.08366216088858723, 'subsample': 0.747182167311131, 'colsample_bytree': 0.7428371478295457, 'gamma': 0.3600120828182491, 'max_delta_step': 0}. Best is trial 18 with value: 74476.28568178075.

 第二次炼丹(n_trial = 50)

 [I 2024-11-28 :47,668] Trial 22 finished with value: 76711.84477931184 and parameters: {'n_estimators': 2984, 'max_depth': 9, 'learning_rate': 0.4975218850483172, 'subsample': 0.7314961178570496, 'colsample_bytree': 0.679824387946018, 'gamma': 0.11843627874594433, 'max_delta_step': 5}. Best is trial 22 with value: 76711.84477931184.

```
# 得到参数后，提交代码
xgb_param = {
    'tree_method': "hist",
    'device': 'cuda',
    'objective': 'reg:squarederror',
    'use_label_encoder': False,
    'random_state': 42,
    'verboseity': 0,
    'n_estimators': 616, 'max_depth': 5, 'learning_rate': 0.08366216088858723, 'subsample': 0.747182167311131,
    'colsample_bytree': 0.7428371478295457, 'gamma': 0.3600120828182491, 'max_delta_step': 0
}

model = XGBRegressor(**xgb_param)
model.fit(X,y)
test_pred = model.predict(test)
df_sub['price'] = test_pred
df_sub.to_csv('submission.csv', index = False)
pd.read_csv('submission.csv')
```
 ![](./Kaggle-PlayGround-Regression-of-Used-Car-Prices.assets/image-001-3c91277105.png)

### Optuna | XGB | oof | 参考大佬
```
def objective_xg(trial, X, y, cv, scoring):
    xg_params = {
        'n_estimators': trial.suggest_int('n_estimators', 100, 3000),
        'max_depth': trial.suggest_int('max_depth', 3, 10),
        'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3),
        'subsample': trial.suggest_float('subsample', 0.5, 1.0),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.5, 1.0),
        'gamma': trial.suggest_float('gamma', 0.0, 5.0),
        'reg_alpha': trial.suggest_float('reg_alpha', 1e-5, 10.0),
        'reg_lambda': trial.suggest_float('reg_lambda', 1e-5, 10.0),
        'random_state': 42,
        'verbosity': 0,
        'device':'cuda' #for GPU
    }

    params=xg_params
    model = XGBRegressor(**params)
    scores = cross_val_score(model, X, y, cv=cv, scoring=scoring)
    rmse = np.mean(scores)
    return rmse
```
```
# optuna 调参 + 5折验证
kf = KFold(n_splits=5, shuffle=True, random_state=42)

study_xg = optuna.create_study(direction="minimize")
func = lambda trial: objective_xg(trial, X, y, cv=kf, scoring=rmse_scorer)
study_xg.optimize(func, n_trials=10, timeout=7200, show_progress_bar=True)

print("XGBoost best params:", study_xg.best_params)
```
没有去除噪声数据，n_trial = 50 时候，调出来的参数：

best_param = {
     'n_estimators': 1410,
      'max_depth': 6,
      'learning_rate': 0.013126073972920788,
      'subsample': 0.8335536830274266,
      'colsample_bytree': 0.5031974577167763,
      'gamma': 2.0645580697886086,
      'reg_alpha': 2.9420317494996704,
      'reg_lambda': 6.7034264819993465,
     'random_state': 42,
         'verbosity': 0,
 }

```
model = XGBRegressor(**study_xg.best_params)
model.fit(X,y)
test_pred = model.predict(test)
df_sub['price'] = test_pred
df_sub.to_csv('submission.csv', index = False)
pd.read_csv('submission.csv')
```
 ![](./Kaggle-PlayGround-Regression-of-Used-Car-Prices.assets/image-002-5cfb5381d9.png)

参考资料：

[1] https://www.kaggle.com/code/yuraslastya/optuna-cv-for-catboost-xgb-lgbm-regressors
