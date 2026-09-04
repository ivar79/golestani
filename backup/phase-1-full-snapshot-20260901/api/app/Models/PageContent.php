<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class PageContent extends Model { protected $table='page_contents'; protected $fillable=['slug','title','content','seo_title','seo_description']; }
